import { Module } from '@nestjs/common';
import { ScraperService } from './scraper.service';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Movie } from '../database/entities/movie.entity';
import { Review } from '../database/entities/review.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Movie, Review])],
  providers: [ScraperService],
})
export class ScraperModule {}
