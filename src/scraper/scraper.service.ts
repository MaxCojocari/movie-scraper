import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  Browser,
  Builder,
  By,
  until,
  WebDriver,
  WebElement,
} from 'selenium-webdriver';
import chrome from 'selenium-webdriver/chrome';
import { Repository } from 'typeorm';
import { Movie } from '../database/entities/movie.entity';
import { Review } from '../database/entities/review.entity';
import { ScrapedMovie, ScrapedReview } from './interfaces';

@Injectable()
export class ScraperService implements OnModuleDestroy {
  private readonly logger = new Logger(ScraperService.name);
  private driver: WebDriver | null = null;
  private readonly baseUrl = 'https://letterboxd.com';
  private waitingList: string[] = [];
  private scrapedMovies: Set<string> = new Set();

  constructor(
    @InjectRepository(Movie)
    private movieRepository: Repository<Movie>,
    @InjectRepository(Review)
    private reviewRepository: Repository<Review>,
  ) {}

  private async getDriver(): Promise<WebDriver> {
    if (!this.driver) {
      const options = new chrome.Options();
      options.addArguments('--headless');
      options.addArguments('--disable-gpu');
      options.addArguments('--no-sandbox');
      options.addArguments('--disable-dev-shm-usage');
      options.addArguments('--window-size=1920,1080');
      options.addArguments(
        '--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      );

      this.driver = await new Builder()
        .forBrowser(Browser.CHROME)
        .setChromeOptions(options)
        .usingServer('http://localhost:4444')
        .build();

      this.logger.log('WebDriver initialized');
    }
    return this.driver;
  }

  /**
   * Main scraping process following the strategy document
   */
  async startScraping(targetNewFilms: number = 100) {
    this.logger.log(
      `Starting scraping process. Target: ${targetNewFilms} new films`,
    );

    let newFilmsParsed = 0;
    let currentPage = 1;

    while (newFilmsParsed < targetNewFilms) {
      // Step 1: Access film list page and collect slugs
      if (this.waitingList.length === 0) {
        this.logger.log(`Fetching film slugs from page ${currentPage}`);
        await this.scrapeFilmListPage(currentPage);
        currentPage++;
      }

      // Step 2: Pop next film from waiting list
      const filmSlug = this.waitingList.pop();

      if (!filmSlug) {
        this.logger.warn('Waiting list is empty, fetching next page');
        continue;
      }

      // Check if already scraped (database query instead of memory)
      const alreadyScraped = await this.isMovieScraped(filmSlug);
      if (alreadyScraped) {
        this.logger.log(`Film ${filmSlug} already scraped, skipping`);
        continue;
      }

      try {
        // Step 2: Scrape film data
        this.logger.log(`Scraping film: ${filmSlug}`);
        const movieData = await this.scrapeMoviePage(filmSlug);

        // Save movie to DB
        await this.saveMovie(movieData);
        newFilmsParsed++;

        this.logger.log(
          `Progress: ${newFilmsParsed}/${targetNewFilms} films scraped`,
        );

        // Step 3: Scrape reviewers from film reviews page
        const reviewers = await this.scrapeFilmReviewers(filmSlug);
        this.logger.log(`Found ${reviewers.length} reviewers for ${filmSlug}`);

        // Step 4 & 5: Process each reviewer
        for (const reviewer of reviewers) {
          await this.processReviewer(reviewer);
        }

        // Small delay between films
        await this.sleep(2000);
      } catch (error) {
        this.logger.error(`Error scraping film ${filmSlug}:`, error.message);
      }
    }

    this.logger.log(`Scraping complete! Parsed ${newFilmsParsed} new films`);
  }

  /**
   * Step 1: Scrape film slugs from popular films page
   */
  private async scrapeFilmListPage(pageNumber: number) {
    const driver = await this.getDriver();
    const url = `${this.baseUrl}/films/popular/page/${pageNumber}/`;

    try {
      await driver.get(url);
      await driver.wait(until.elementLocated(By.css('ul.poster-list')), 10000);
      await this.sleep(1000);

      // Find all poster items
      const posterItems = await driver.findElements(By.css('li.posteritem'));

      for (const item of posterItems) {
        try {
          const reactDiv = await item.findElement(By.css('.react-component'));
          const itemSlug = await reactDiv.getAttribute('data-item-slug');
          if (itemSlug) {
            this.waitingList.push(itemSlug);
          }
        } catch (e) {
          // Skip if can't find slug
        }
      }

      this.logger.log(
        `Added ${posterItems.length} films to waiting list from page ${pageNumber}`,
      );
    } catch (error) {
      this.logger.error(
        `Error scraping film list page ${pageNumber}:`,
        error.message,
      );
      throw error;
    }
  }

  /**
   * Step 2: Scrape individual movie page
   */
  private async scrapeMoviePage(slug: string): Promise<ScrapedMovie> {
    const driver = await this.getDriver();
    const url = `${this.baseUrl}/film/${slug}/`;

    try {
      await driver.get(url);
      await driver.wait(until.elementLocated(By.css('body')), 10000);
      await this.sleep(1000);

      const movie: ScrapedMovie = {
        slug,
        title: '',
        releaseYear: 0,
        watchedBy: 0,
        avgRating: 0,
        synopsis: '',
        genres: [],
        themes: [],
        director: [],
        cast: [],
      };

      // Title
      try {
        const titleEl = await driver.findElement(By.css('h1.headline-1 .name'));
        movie.title = await titleEl.getText();
      } catch (e) {
        this.logger.warn(`Title not found for ${slug}`);
      }

      // Release Year
      try {
        const yearEl = await driver.findElement(By.css('.releasedate a'));
        const yearText = await yearEl.getText();
        movie.releaseYear = parseInt(yearText);
      } catch (e) {
        this.logger.warn(`Release year not found for ${slug}`);
      }

      // Watched By - Extract from data-original-title attribute
      try {
        const watchedEl = await driver.findElement(
          By.css('a.tooltip[href*="/members/"]'),
        );
        const titleAttr = await watchedEl.getAttribute('data-original-title');
        // Extract number from "Watched by 6,069,845&nbsp;members"
        const match = titleAttr.match(/Watched by ([\d,]+)/);
        if (match) {
          movie.watchedBy = parseInt(match[1].replace(/,/g, ''));
        }
      } catch (e) {
        this.logger.warn(`Watched by not found for ${slug}`);
      }

      // Average Rating
      try {
        const ratingEl = await driver.findElement(By.css('.average-rating a'));
        const ratingText = await ratingEl.getText();
        movie.avgRating = parseFloat(ratingText);
      } catch (e) {
        this.logger.warn(`Rating not found for ${slug}`);
      }

      // Synopsis
      try {
        const synopsisEl = await driver.findElement(By.css('.truncate p'));
        movie.synopsis = await synopsisEl.getText();
      } catch (e) {
        try {
          const synopsisEl = await driver.findElement(
            By.css('.review.body-text p'),
          );
          movie.synopsis = await synopsisEl.getText();
        } catch (e2) {
          this.logger.warn(`Synopsis not found for ${slug}`);
        }
      }

      // Cast (first 10 from main page)
      try {
        // Find the cast list container
        const castList = await driver.findElement(
          By.css('#tab-cast .cast-list'),
        );

        // Get all cast links (both visible and hidden in overflow)
        const castElements = await castList.findElements(
          By.css('a.text-slug[href*="/actor/"]'),
        );

        for (const el of castElements.slice(0, 10)) {
          const name = await el.getText();
          if (name && name.trim()) {
            movie.cast.push(name.trim());
          }
        }
      } catch (e) {
        this.logger.warn(`Cast not found for ${slug}:`, e.message);
      }

      // Click Genres tab and extract genres
      try {
        const genresTab = await driver.findElement(
          By.css('a[data-id="genres"]'),
        );
        await genresTab.click();
        await this.sleep(500);

        const tabGenres = await driver.findElement(By.css('#tab-genres'));
        const genreDiv = await tabGenres.findElement(By.css('.text-sluglist'));
        const genreLinks = await genreDiv.findElements(By.css('a.text-slug'));

        for (const link of genreLinks) {
          const genre = await link.getText();
          if (genre) movie.genres.push(genre);
        }
      } catch (e) {
        this.logger.warn(`Genres not found for ${slug}`);
      }

      // Themes are in the same tab as genres (no need to click)
      try {
        const tabGenres = await driver.findElement(By.css('#tab-genres'));
        const allTextSluglists = await tabGenres.findElements(
          By.css('.text-sluglist'),
        );

        // Second .text-sluglist contains themes (first one is genres)
        if (allTextSluglists.length > 1) {
          const themesDiv = allTextSluglists[1];
          const themeLinks = await themesDiv.findElements(
            By.css('a.text-slug'),
          );

          for (const link of themeLinks) {
            const theme = await link.getText();
            if (theme && theme !== 'Show All…') {
              movie.themes.push(theme);
            }
          }
        }
      } catch (e) {
        this.logger.warn(`Themes not found for ${slug}`);
      }

      // Click Crew tab and extract director
      try {
        const crewTab = await driver.findElement(By.css('a[data-id="crew"]'));
        await crewTab.click();
        await this.sleep(500);

        const directorElements = await driver.findElements(
          By.css('#tab-crew a[href*="/director/"].text-slug'),
        );
        for (const el of directorElements) {
          const name = await el.getText();
          if (name) movie.director.push(name);
        }
      } catch (e) {
        this.logger.warn(`Director not found for ${slug}`);
      }

      return movie;
    } catch (error) {
      this.logger.error(`Error scraping movie page ${slug}:`, error.message);
      throw error;
    }
  }

  /**
   * Step 3: Scrape reviewer usernames from film reviews page (12 per page)
   */
  private async scrapeFilmReviewers(
    filmSlug: string,
    page: number = 1,
  ): Promise<string[]> {
    const driver = await this.getDriver();
    const url = `${this.baseUrl}/film/${filmSlug}/reviews/by/activity/page/${page}/`;
    const reviewers: string[] = [];

    try {
      await driver.get(url);
      await driver.wait(until.elementLocated(By.css('body')), 10000);
      await this.sleep(1000);

      // Find all avatar links
      const avatarLinks = await driver.findElements(By.css('article a.avatar'));

      for (const link of avatarLinks) {
        const href = await link.getAttribute('href');
        if (href) {
          // Extract username from href like "/philbertdy/"
          const { pathname } = new URL(href);
          const username = pathname.split('/').filter(Boolean)[0];
          if (username) {
            reviewers.push(username);
          }
        }
      }

      this.logger.log(
        `Found ${reviewers.length} reviewers on page ${page} for ${filmSlug}`,
      );
    } catch (error) {
      this.logger.warn(
        `Error scraping reviewers for ${filmSlug}:`,
        error.message,
      );
    }

    return reviewers;
  }

  /**
   * Step 4 & 5: Process reviewer - scrape their reviews and add film slugs to waiting list
   */
  private async processReviewer(username: string) {
    const driver = await this.getDriver();
    const url = `${this.baseUrl}/${username}/films/reviews/by/activity/page/1/`;

    try {
      this.logger.log(`Processing reviewer: ${username}`);
      await driver.get(url);
      await driver.wait(until.elementLocated(By.css('body')), 10000);
      await this.sleep(1000);

      // Find all review articles (12 per page)
      const reviewArticles = await driver.findElements(
        By.css('div.listitem.js-listitem'),
      );

      for (const article of reviewArticles) {
        try {
          // Extract film slug from poster link
          const posterLink = await article.findElement(By.css('.poster a'));
          const href = await posterLink.getAttribute('href');
          const { pathname } = new URL(href);
          const filmSlug = pathname.split('/').filter(Boolean)[1];

          // Extract rating
          let rating: number | null = null;
          try {
            const ratingEl = await article.findElement(By.css('.rating'));
            const ratingClass = await ratingEl.getAttribute('class');
            const match = ratingClass.match(/rated-(\d+)/);
            if (match) {
              rating = parseInt(match[1]); // Store as 1-10
            }
          } catch (e) {}

          // Extract review text
          const reviewText = await this.extractFullReviewText(article);

          // Save review to DB
          const review: ScrapedReview = {
            userUid: username,
            movieUid: filmSlug,
            rating,
            reviewText,
          };

          await this.saveReview(review);

          // Step 5: Add film slug to waiting list if not already scraped
          if (
            !this.scrapedMovies.has(filmSlug) &&
            !this.waitingList.includes(filmSlug)
          ) {
            this.waitingList.push(filmSlug);
            this.logger.log(
              `Added ${filmSlug} to waiting list from ${username}'s reviews`,
            );
          }
        } catch (error) {
          this.logger.warn(
            `Error processing review in ${username}'s page:`,
            error.message,
          );
        }
      }
    } catch (error) {
      this.logger.error(
        `Error processing reviewer ${username}:`,
        error.message,
      );
    }
  }

  /**
   * Extract full review text handling spoilers and "more" expansions
   */
  private async extractFullReviewText(
    articleElement: WebElement,
  ): Promise<string> {
    try {
      // Check for spoiler warning
      const spoilerElements = await articleElement.findElements(
        By.css('p.body-text.-prose.js-spoiler-container'),
      );

      if (spoilerElements.length > 0) {
        // Click "I can handle the truth"
        try {
          const spoilerLink = await articleElement.findElement(
            By.css('a[data-js-trigger="spoiler.reveal"]'),
          );
          await spoilerLink.click();
          await this.sleep(500);
        } catch (e) {}
      }

      // Check for "more" expansion
      const moreElements = await articleElement.findElements(
        By.css('.collapsed-text'),
      );

      if (moreElements.length > 0) {
        try {
          const moreLink = await articleElement.findElement(
            By.css('a[data-js-trigger="collapsible.expand"]'),
          );
          await moreLink.click();
          await this.sleep(500);
        } catch (e) {}
      }

      // Extract all paragraphs
      const reviewBody = await articleElement.findElement(
        By.css('.js-review-body'),
      );
      const paragraphs = await reviewBody.findElements(By.css('p'));

      const texts: string[] = [];
      for (const p of paragraphs) {
        const text = await p.getText();
        if (text && !text.includes('This review may contain spoilers')) {
          texts.push(text);
        }
      }

      return texts.join('\n\n');
    } catch (error) {
      // Fallback: just get whatever text is available
      try {
        const reviewBody = await articleElement.findElement(
          By.css('.body-text'),
        );
        return await reviewBody.getText();
      } catch (e) {
        return '';
      }
    }
  }

  /**
   * Save movie to database
   */
  private async saveMovie(movieData: ScrapedMovie): Promise<void> {
    const movie = new Movie();
    movie.movieUid = movieData.slug;
    movie.movieName = movieData.title;
    movie.releaseYear = movieData.releaseYear;
    movie.watchedBy = movieData.watchedBy;
    movie.avgRating = movieData.avgRating;
    movie.synopsis = movieData.synopsis;
    movie.genres = movieData.genres.join(', ');
    movie.themes = movieData.themes.join('|');
    movie.director = movieData.director.join(', ');
    movie.cast = movieData.cast.join(', ');

    await this.movieRepository.save(movie);
    this.logger.log(`Saved movie: ${movieData.title} (${movieData.slug})`);
  }

  /**
   * Save review to database
   */
  private async saveReview(reviewData: ScrapedReview): Promise<void> {
    const review = new Review();
    review.userUid = reviewData.userUid;
    review.movieUid = reviewData.movieUid;
    review.rating = reviewData.rating!;
    review.reviewText = reviewData.reviewText;

    await this.reviewRepository.save(review);
    this.logger.log(
      `Saved review: ${reviewData.userUid} -> ${reviewData.movieUid}`,
    );
  }

  /**
   * Check if movie already exists in database (optimized - no memory loading)
   */
  private async isMovieScraped(slug: string): Promise<boolean> {
    const count = await this.movieRepository.count({
      where: { movieUid: slug },
    });
    return count > 0;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async onModuleDestroy() {
    if (this.driver) {
      await this.driver.quit();
      this.logger.log('WebDriver closed');
    }
  }
}
