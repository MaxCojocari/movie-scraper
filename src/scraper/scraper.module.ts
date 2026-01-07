import { Module } from '@nestjs/common';
import { ScraperService } from './scraper.service';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Movie } from '../database/entities/movie.entity';
import { Review } from '../database/entities/review.entity';
import { WaitingList } from '../database/entities/waiting-list.entity';
import { ScraperController } from './scraper.controller';
import { ProcessedUser } from '../database/entities/processed-movie.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([Movie, Review, WaitingList, ProcessedUser]),
  ],
  providers: [ScraperService],
  controllers: [ScraperController],
})
export class ScraperModule {}
