import { Controller, Delete, Get, Post, Query } from '@nestjs/common';
import { ScraperService } from './scraper.service';
import { count } from 'console';

@Controller('scraper')
export class ScraperController {
  constructor(private readonly scraperService: ScraperService) {}

  @Post('start')
  async startScraping(
    @Query('target') target?: number,
    @Query('batch_size') batchSize?: number,
    @Query('max_queue_size') maxQueueSize?: number,
  ) {
    this.scraperService.startScraping(target, batchSize, maxQueueSize);

    return {
      message: `Scraping started. Target: ${target} films, Batch: ${batchSize}, Max Queue: ${maxQueueSize}`,
    };
  }

  @Get('queue/status')
  async getQueueStatus() {
    const size = await this.scraperService.getWaitingListSize();
    return { queueSize: size };
  }

  @Delete('queue/clear')
  async clearQueue() {
    await this.scraperService.clearWaitingList();
    return { message: 'Queue cleared' };
  }

  @Post('movies/repair')
  async repairIncompleteMovies(
    @Query('batch_size') batchSize?: number,
    @Query('max_movies') maxMovies?: number,
  ) {
    this.scraperService.repairIncompleteMovies(batchSize, maxMovies);

    return {
      message: 'Started repairing incomplete movies',
    };
  }

  @Post('process-queue')
  async processWaitingList() {
    const queueSize = await this.scraperService.getWaitingListSize();

    if (queueSize === 0) {
      return {
        message: 'Queue is empty. Nothing to process.',
        queueSize: 0,
      };
    }

    this.scraperService.processWaitingList();

    return {
      message: 'Started processing waiting list',
      queueSize,
    };
  }

  @Post('enrich-reviews')
  async enrichReviews(
    @Query('partition_index') partitionIndex?: number,
    @Query('total_partitions') totalPartitions?: number,
  ) {
    this.scraperService.enrichExistingUsersWithPopularFilmReviews(
      partitionIndex,
      totalPartitions,
    );
    return {
      message: 'Started enriching reviews',
    };
  }

  @Get('user-ids')
  async getUnprocessedUserIdsFromReviews() {
    const res = await this.scraperService.getAllUserIdsFromReviews();
    return {
      count: res.length,
      ids: res,
    };
  }
}
