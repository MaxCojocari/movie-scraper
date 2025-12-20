import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Browser, Builder, By, until, WebDriver } from 'selenium-webdriver';
import chrome from 'selenium-webdriver/chrome';
import { Repository } from 'typeorm';
import { Movie } from '../database/entities/movie.entity';
import { Review } from '../database/entities/review.entity';

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
  async startScraping(targetNewFilms: number = 1): Promise<void> {
    this.logger.log(
      `Starting scraping process. Target: ${targetNewFilms} new films`,
    );

    let newFilmsParsed = 0;
    let currentPage = 1;

    // Load already scraped movies from DB
    await this.loadScrapedMovies();

    await this.scrapeFilmListPage(1);
    console.log('Scrapped slugs:', this.waitingList);

    // while (newFilmsParsed < targetNewFilms) {
    //   // Step 1: Access film list page and collect slugs
    //   if (this.waitingList.length === 0) {
    //     this.logger.log(`Fetching film slugs from page ${currentPage}`);
    //     await this.scrapeFilmListPage(currentPage);
    //     currentPage++;
    //   }

    //   // Step 2: Pop next film from waiting list
    //   const filmSlug = this.waitingList.pop();

    //   if (!filmSlug) {
    //     this.logger.warn('Waiting list is empty, fetching next page');
    //     continue;
    //   }

    //   // Check if already scraped
    //   if (this.scrapedMovies.has(filmSlug)) {
    //     this.logger.log(`Film ${filmSlug} already scraped, skipping`);
    //     continue;
    //   }

    //   try {
    //     // Step 2: Scrape film data
    //     this.logger.log(`Scraping film: ${filmSlug}`);
    //     const movieData = await this.scrapeMoviePage(filmSlug);

    //     // Save movie to DB
    //     await this.saveMovie(movieData);
    //     this.scrapedMovies.add(filmSlug);
    //     newFilmsParsed++;

    //     this.logger.log(
    //       `Progress: ${newFilmsParsed}/${targetNewFilms} films scraped`,
    //     );

    //     // Step 3: Scrape reviewers from film reviews page
    //     const reviewers = await this.scrapeFilmReviewers(filmSlug);
    //     this.logger.log(`Found ${reviewers.length} reviewers for ${filmSlug}`);

    //     // Step 4 & 5: Process each reviewer
    //     for (const reviewer of reviewers) {
    //       await this.processReviewer(reviewer, filmSlug);
    //     }

    //     // Small delay between films
    //     await this.sleep(2000);
    //   } catch (error) {
    //     this.logger.error(`Error scraping film ${filmSlug}:`, error.message);
    //   }
    // }

    // this.logger.log(`Scraping complete! Parsed ${newFilmsParsed} new films`);
  }

  /**
   * Load already scraped movies from DB
   */
  private async loadScrapedMovies() {
    const movies = await this.movieRepository.find({
      select: ['movieUid'],
    });

    this.scrapedMovies = new Set(movies.map((m) => m.movieUid));
    this.logger.log(
      `Loaded ${this.scrapedMovies.size} already scraped movies from DB`,
    );
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
      await this.sleep(1500);

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
