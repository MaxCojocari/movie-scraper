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
import { WaitingList } from '../database/entities/waiting-list.entity';
import { createHash } from 'crypto';

@Injectable()
export class ScraperService implements OnModuleDestroy {
  private readonly logger = new Logger(ScraperService.name);
  private driver: WebDriver;
  private readonly baseUrl = 'https://letterboxd.com';

  constructor(
    @InjectRepository(Movie)
    private movieRepository: Repository<Movie>,
    @InjectRepository(Review)
    private reviewRepository: Repository<Review>,
    @InjectRepository(WaitingList)
    private waitingListRepository: Repository<WaitingList>,
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
  async startScraping(
    targetNewFilms: number = 100,
    batchSize: number = 20,
    maxQueueSize: number = 25_000,
  ): Promise<void> {
    this.logger.log(
      `Starting scraping process. Target: ${targetNewFilms} new films (batch size: ${batchSize})`,
    );

    let newFilmsParsed = 0;
    let currentPage = 1;
    let filmBatch: string[] = [];

    while (newFilmsParsed < targetNewFilms) {
      // Step 1: Refill batch if empty
      if (filmBatch.length === 0) {
        const queueSize = await this.getWaitingListSize();

        if (queueSize === 0) {
          this.logger.log(
            `Waiting list empty. Fetching film slugs from page ${currentPage}`,
          );
          await this.scrapeFilmListPage(currentPage);
          currentPage++;
        }

        // Pop batch of films
        filmBatch = await this.popBatchFromWaitingList(batchSize);

        if (filmBatch.length === 0) {
          this.logger.warn('No films in waiting list after fetch attempt');
          continue;
        }

        this.logger.log(`Processing batch of ${filmBatch.length} films`);
      }

      // Step 2: Process next film from batch
      const filmSlug = filmBatch.shift();

      if (!filmSlug || (await this.isMovieScraped(filmSlug))) {
        continue;
      }

      try {
        // Step 2: Scrape film data
        this.logger.log(
          `Scraping film: ${filmSlug} (${newFilmsParsed + 1}/${targetNewFilms})`,
        );
        const movieData = await this.scrapeMoviePage(filmSlug);

        // Save movie to DB
        await this.saveMovie(movieData);
        newFilmsParsed++;

        // this.logger.log(
        //   `Progress: ${newFilmsParsed}/${targetNewFilms} films scraped | Queue: ${await this.getWaitingListSize()} | Batch: ${filmBatch.length}`,
        // );

        // // Step 3: Scrape reviewers from film reviews page
        // const reviewers = await this.scrapeFilmReviewers(filmSlug);
        // this.logger.log(`Found ${reviewers.length} reviewers for ${filmSlug}`);

        // // Step 4 & 5: Process each reviewer
        // for (const reviewer of reviewers) {
        //   await this.processReviewer(reviewer);
        // }

        const currentQueueSize = await this.getWaitingListSize();
        this.logger.log(
          `Progress: ${newFilmsParsed}/${targetNewFilms} | Queue: ${currentQueueSize}/${maxQueueSize} | Batch: ${filmBatch.length}`,
        );

        // Check if queue is below max size before scraping reviews
        if (currentQueueSize < maxQueueSize) {
          const reviewers = await this.scrapeFilmReviewers(filmSlug);
          this.logger.log(
            `Found ${reviewers.length} reviewers for ${filmSlug}`,
          );

          for (const reviewer of reviewers) {
            // Check queue size before processing each reviewer
            const queueSize = await this.getWaitingListSize();
            if (queueSize >= maxQueueSize) {
              this.logger.warn(
                `Queue full (${queueSize}/${maxQueueSize}). Skipping remaining reviewers for ${filmSlug}`,
              );
              break;
            }
            await this.processReviewer(reviewer);
          }
        } else {
          this.logger.warn(
            `Queue at max capacity (${currentQueueSize}/${maxQueueSize}). Skipping review scraping for ${filmSlug}`,
          );
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
      await driver.wait(until.elementLocated(By.css('ul.poster-list')), 30000);
      await this.sleep(1500);

      // Find all poster items
      const posterItems = await driver.findElements(By.css('li.posteritem'));

      for (const item of posterItems) {
        try {
          const reactDiv = await item.findElement(By.css('.react-component'));
          const itemSlug = await reactDiv.getAttribute('data-item-slug');
          if (itemSlug) {
            await this.pushToWaitingList(itemSlug);
          }
        } catch (e) {
          // Skip if can't find slug
        }
      }
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
      await driver.wait(until.elementLocated(By.css('body')), 30000);
      await this.sleep(1500);

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
        const ratingEl = await driver.findElement(
          By.css('.average-rating a.tooltip'),
        );
        const titleAttr = await ratingEl.getAttribute('data-original-title');

        const match = titleAttr.match(/Weighted average of ([\d.]+)/);

        if (match) {
          movie.avgRating = parseFloat(match[1]);
        } else {
          const ratingText = await ratingEl.getText();
          movie.avgRating = parseFloat(ratingText);
        }
      } catch (e) {
        this.logger.warn(`Rating not found for ${slug}`);
      }

      // Synopsis
      try {
        // Check if there's a "...more" button and click it
        try {
          const moreButton = await driver.findElement(
            By.css('.condense_control_more'),
          );
          await moreButton.click();
          await this.sleep(500);
          this.logger.log(`Expanded synopsis for ${slug}`);
        } catch (e) {
          // No "...more" button, synopsis is already fully visible
        }

        // Extract full synopsis from the expanded div
        try {
          // Try to get from the condenseable div (which becomes visible after clicking)
          const synopsisDiv = await driver.findElement(
            By.css('.truncate.condenseable'),
          );
          const paragraphs = await synopsisDiv.findElements(By.css('p'));

          const synopsisTexts: string[] = [];
          for (const p of paragraphs) {
            const text = await p.getText();
            // Remove the "×" close button text if present
            const cleanText = text.replace(/×\s*$/, '').trim();
            if (cleanText) {
              synopsisTexts.push(cleanText);
            }
          }

          movie.synopsis = synopsisTexts.join('\n\n');
        } catch (e) {
          // Fallback: try the original selector
          const synopsisEl = await driver.findElement(By.css('.truncate p'));
          movie.synopsis = await synopsisEl.getText();
        }
      } catch (e) {
        this.logger.warn(`Synopsis not found for ${slug}`);
        console.log(e);
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
        // Scroll element into view
        await driver.executeScript(
          'arguments[0].scrollIntoView({block: "center"});',
          genresTab,
        );
        await this.sleep(500); // Wait for scroll to complete
        await genresTab.click();
        await driver.wait(
          until.elementIsVisible(driver.findElement(By.css('#tab-genres'))),
          5000,
        );

        const tabGenres = await driver.findElement(By.css('#tab-genres'));
        const genreDiv = await tabGenres.findElement(By.css('.text-sluglist'));
        const genreLinks = await genreDiv.findElements(By.css('a.text-slug'));

        for (const link of genreLinks) {
          const genre = await link.getText();
          if (genre) movie.genres.push(genre);
        }
      } catch (e) {
        this.logger.warn(`Genres not found for ${slug}`);
        console.log(e);
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
        console.log(e);
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
        console.log(e);
      }

      return movie;
    } catch (error) {
      this.logger.error(`Error scraping movie page ${slug}:`, error.message);
      throw error;
    }
  }

  /**
   * Find movies with incomplete data
   */
  async findIncompleteMovies(): Promise<string[]> {
    const incompleteMovies = await this.movieRepository
      .createQueryBuilder('movie')
      .select('movie.movieUid')
      .where(
        `movie.movieName IS NULL OR movie.movieName = '' OR
       movie.releaseYear IS NULL OR movie.releaseYear = 0 OR
       movie.watchedBy IS NULL OR movie.watchedBy = 0 OR
       movie.avgRating IS NULL OR movie.avgRating = 0 OR
       movie.synopsis IS NULL OR movie.synopsis = '' OR
       movie.genres IS NULL OR movie.genres = '' OR
       movie.themes IS NULL OR movie.themes = '' OR
       movie.director IS NULL OR movie.director = '' OR
       movie.cast IS NULL OR movie.cast = ''`,
      )
      .getMany();

    return incompleteMovies.map((m) => m.movieUid);
  }

  async repairIncompleteMovies(
    batchSize: number = 1,
    maxMovies?: number,
  ): Promise<void> {
    this.logger.log('Starting incomplete movies repair process');

    const incompleteMovieIds = await this.findIncompleteMovies();

    if (incompleteMovieIds.length === 0) {
      this.logger.log('No incomplete movies found. All data is complete!');
      return;
    }

    const totalToRepair = maxMovies
      ? Math.min(incompleteMovieIds.length, maxMovies)
      : incompleteMovieIds.length;

    this.logger.log(
      `Found ${incompleteMovieIds.length} incomplete movies. ` +
        `Will repair ${totalToRepair} movies.`,
    );

    // Process in batches
    for (let i = 0; i < totalToRepair; i += batchSize) {
      const batch = incompleteMovieIds.slice(
        i,
        Math.min(i + batchSize, totalToRepair),
      );

      this.logger.log(
        `Processing batch ${Math.floor(i / batchSize) + 1}: ${batch.length} movies`,
      );

      for (const movieUid of batch) {
        try {
          // Get current movie data
          const oldMovie = await this.movieRepository.findOne({
            where: { movieUid },
          });

          if (!oldMovie) {
            this.logger.warn(`Movie ${movieUid} not found in database`);
            continue;
          }

          this.logger.log(
            `Re-scraping: ${movieUid} (${oldMovie.movieName || 'Unknown'})`,
          );

          // Re-scrape the movie
          const newMovieData = await this.scrapeMoviePage(movieUid);

          // Compare and update only missing fields
          const updates: any = {};
          let hasUpdates = false;

          if (!oldMovie.movieName || oldMovie.movieName === '') {
            updates.title = newMovieData.title;
            hasUpdates = true;
          }
          if (!oldMovie.releaseYear || oldMovie.releaseYear === 0) {
            updates.releaseYear = newMovieData.releaseYear;
            hasUpdates = true;
          }
          if (!oldMovie.watchedBy || oldMovie.watchedBy === 0) {
            updates.watchedByCount = newMovieData.watchedBy;
            hasUpdates = true;
          }
          if (!oldMovie.avgRating || oldMovie.avgRating === 0) {
            updates.avgRating = newMovieData.avgRating;
            hasUpdates = true;
          }
          if (!oldMovie.synopsis || oldMovie.synopsis === '') {
            updates.synopsis = newMovieData.synopsis;
            hasUpdates = true;
          }
          if (!oldMovie.genres || oldMovie.genres === '') {
            updates.genres = newMovieData.genres.join(', ');
            hasUpdates = true;
          }
          if (!oldMovie.themes || oldMovie.themes === '') {
            updates.themes = newMovieData.themes.join('|');
            hasUpdates = true;
          }
          if (!oldMovie.director || oldMovie.director === '') {
            updates.director = newMovieData.director.join(', ');
            hasUpdates = true;
          }
          if (!oldMovie.cast || oldMovie.cast === '') {
            updates.cast = newMovieData.cast.join(', ');
            hasUpdates = true;
          }

          if (hasUpdates) {
            // Update the movie
            await this.movieRepository.update({ movieUid }, updates);
            const updatedFields = Object.keys(updates).join(', ');
            this.logger.log(
              `Repaired ${movieUid}: Updated fields [${updatedFields}]`,
            );
          } else {
            this.logger.log(
              `No missing fields found for ${movieUid} (already complete)`,
            );
          }

          // Small delay to avoid overwhelming the server
          await this.sleep(2000);
        } catch (error) {
          this.logger.error(`Failed to repair ${movieUid}:`, error.message);
        }
      }

      this.logger.log('Repair process complete!');
    }
  }
  /**
   * Update a single movie by re-scraping
   */
  async updateSingleMovie(
    movieUid: string,
  ): Promise<{ success: boolean; message: string; updated?: any }> {
    try {
      const oldMovie = await this.movieRepository.findOne({
        where: { movieUid },
      });

      if (!oldMovie) {
        return {
          success: false,
          message: `Movie ${movieUid} not found in database`,
        };
      }

      this.logger.log(`Re-scraping movie: ${movieUid}`);

      const newMovieData = await this.scrapeMoviePage(movieUid);

      // Update all fields
      oldMovie.movieName = newMovieData.title;
      oldMovie.releaseYear = newMovieData.releaseYear;
      oldMovie.watchedBy = newMovieData.watchedBy;
      oldMovie.avgRating = newMovieData.avgRating;
      oldMovie.synopsis = newMovieData.synopsis;
      oldMovie.genres = newMovieData.genres.join(', ');
      oldMovie.themes = newMovieData.themes.join('|');
      oldMovie.director = newMovieData.director.join(', ');
      oldMovie.cast = newMovieData.cast.join(', ');

      await this.movieRepository.save(oldMovie);

      return {
        success: true,
        message: `Successfully updated ${movieUid}`,
        updated: {
          title: newMovieData.title,
          releaseYear: newMovieData.releaseYear,
          avgRating: newMovieData.avgRating,
        },
      };
    } catch (error) {
      return {
        success: false,
        message: `Failed to update ${movieUid}: ${error.message}`,
      };
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
      await driver.wait(until.elementLocated(By.css('body')), 30000);
      await this.sleep(1500);

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
      await driver.wait(until.elementLocated(By.css('body')), 30000);
      await this.sleep(1500);

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
          const alreadyScraped = await this.isMovieScraped(filmSlug);
          if (!alreadyScraped) {
            await this.pushToWaitingList(filmSlug);
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
   * Process existing waiting list without adding new films
   * Scrapes movies already queued, skips review scraping
   */
  async processWaitingList(): Promise<void> {
    this.logger.log('Starting waiting list processing (no new film discovery)');

    let filmsProcessed = 0;

    // Get initial queue size
    const initialQueueSize = await this.getWaitingListSize();
    this.logger.log(`Initial queue size: ${initialQueueSize} films`);

    while (true) {
      // Pop one film from waiting list
      const filmSlug = await this.popFromWaitingList();

      if (!filmSlug) {
        this.logger.log('✅ Waiting list is empty. Processing complete!');
        break;
      }

      // Check if already scraped
      const alreadyScraped = await this.isMovieScraped(filmSlug);
      if (alreadyScraped) {
        this.logger.log(`Film ${filmSlug} already scraped, skipping`);
        continue;
      }

      try {
        this.logger.log(`Scraping film: ${filmSlug}`);
        const movieData = await this.scrapeMoviePage(filmSlug);

        await this.saveMovie(movieData);
        filmsProcessed++;

        const remainingQueue = await this.getWaitingListSize();

        this.logger.log(
          `Processed: ${filmsProcessed} | Remaining: ${remainingQueue}`,
        );

        await this.sleep(2000);
      } catch (error) {
        this.logger.error(`Error scraping film ${filmSlug}:`, error.message);
      }
    }

    this.logger.log(`🎉 Waiting list processing complete!`);
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
    const reviewHash = this.generateReviewHash(reviewData);

    const existing = await this.reviewRepository.findOne({
      where: { reviewHash },
    });

    if (existing) {
      this.logger.log(
        `Review hash ${reviewHash.substring(0, 8)}... already exists, skipping`,
      );
      return;
    }

    const review = new Review();
    review.userUid = reviewData.userUid;
    review.movieUid = reviewData.movieUid;
    review.rating = reviewData.rating!;
    review.reviewText = reviewData.reviewText;
    review.reviewHash = reviewHash;

    await this.reviewRepository.save(review);
    this.logger.log(
      `Saved review: ${reviewData.userUid} -> ${reviewData.movieUid}`,
    );
  }

  private generateReviewHash(reviewData: ScrapedReview): string {
    const content = [
      reviewData.userUid,
      reviewData.movieUid,
      reviewData.rating?.toString() || '',
      reviewData.reviewText.trim(),
    ].join('|');

    return createHash('sha256').update(content).digest('hex');
  }

  /**
   * Push movie to waiting list (Stack LIFO - higher priority processed first)
   */
  private async pushToWaitingList(movieId: string): Promise<void> {
    try {
      // Check if already in waiting list
      const existing = await this.waitingListRepository.findOne({
        where: { movieId },
      });

      if (existing) {
        this.logger.log(`Movie ${movieId} already in waiting list`);
        return;
      }

      // Use current timestamp as priority for LIFO (later = higher priority)
      const priority = Date.now();

      const item = new WaitingList();
      item.movieId = movieId;
      item.priority = priority;

      await this.waitingListRepository.save(item);
      this.logger.log(
        `Added ${movieId} to waiting list (priority: ${priority})`,
      );
    } catch (error) {
      // Ignore duplicate key errors
      if (
        !error.message.includes('duplicate') &&
        !error.message.includes('unique')
      ) {
        this.logger.error(`Error adding to waiting list:`, error.message);
      }
    }
  }

  /**
   * Pop batch of movies from waiting list (Stack LIFO - highest priority first)
   * More efficient than popping one at a time
   */
  private async popBatchFromWaitingList(
    batchSize: number = 10,
  ): Promise<string[]> {
    // Get items with highest priority (most recent)
    const items = await this.waitingListRepository.find({
      order: { priority: 'DESC' }, // Descending = LIFO stack behavior
      take: batchSize,
    });

    if (items.length === 0) {
      return [];
    }

    // Remove batch from waiting list
    await this.waitingListRepository.remove(items);

    const movieIds = items.map((item) => item.movieId);
    this.logger.log(
      `Popped batch of ${movieIds.length} movies from waiting list`,
    );

    return movieIds;
  }

  private async popFromWaitingList(): Promise<string | null> {
    try {
      const item = await this.waitingListRepository.findOne({
        where: {},
        order: { priority: 'DESC' },
      });

      if (!item) {
        return null;
      }

      const movieId = item.movieId;
      await this.waitingListRepository.remove(item);

      return movieId;
    } catch (error) {
      this.logger.error('Error popping from waiting list:', error.message);
      return null;
    }
  }

  /**
   * Get waiting list size
   */
  async getWaitingListSize(): Promise<number> {
    return await this.waitingListRepository.count();
  }

  /**
   * Clear waiting list (for testing/reset)
   */
  async clearWaitingList(): Promise<void> {
    await this.waitingListRepository.clear();
    this.logger.log('Waiting list cleared');
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
