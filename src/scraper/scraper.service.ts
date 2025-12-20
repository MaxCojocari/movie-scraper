import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Browser, Builder, until, WebDriver } from 'selenium-webdriver';
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

  async startScraping() {
    const driver = await this.getDriver();
    const url = 'https://www.google.com/';
    try {
      await driver.get(url);
      await driver.wait(until.titleIs(await driver.getTitle()), 5000);

      const title = await driver.getTitle();
      const currentUrl = await driver.getCurrentUrl();

      console.log({
        title,
        url: currentUrl,
      });
    } catch (error) {
      console.error('Error scraping website:', error);
      throw error;
    }
  }

  async getHello() {
    console.log('Hello World!');
  }

  async onModuleDestroy() {
    if (this.driver) {
      await this.driver.quit();
      this.logger.log('WebDriver closed');
    }
  }
}
