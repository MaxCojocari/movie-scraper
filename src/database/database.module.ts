import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Movie } from './entities/movie.entity';
import { Review } from './entities/review.entity';

@Module({
  imports: [
    TypeOrmModule.forRoot({
      type: 'postgres',
      host: 'localhost',
      port: 5432,
      username: 'postgres',
      password: 'postgres',
      database: 'letterboxd',
      entities: [Movie, Review],
      autoLoadEntities: true,
      synchronize: true,
    }),
    TypeOrmModule.forFeature([Movie, Review]),
  ],
  exports: [TypeOrmModule],
})
export class DatabaseModule {}
