import { Module } from '@nestjs/common';
import { ScraperService } from './scraper.service';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Movie } from '../database/entities/movie.entity';
import { Review } from '../database/entities/review.entity';
import { WaitingList } from '../database/entities/waiting-list.entity';
import { ScraperController } from './scraper.controller';

@Module({
  imports: [TypeOrmModule.forFeature([Movie, Review, WaitingList])],
  providers: [ScraperService],
  controllers: [ScraperController],
})
export class ScraperModule {}
