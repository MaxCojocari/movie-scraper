import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { Movie } from './movie.entity';

@Entity('reviews')
export class Review {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ name: 'user_uid' })
  userUid: string; // username

  @Column({ name: 'movie_uid' })
  movieUid: string;

  @Column({ name: 'rating', type: 'int', nullable: true })
  rating: number; // out of 10 (rated-10 = 5 stars = 10)

  @Column({ name: 'review_text', type: 'text' })
  reviewText: string;

  @ManyToOne(() => Movie, (movie) => movie.reviews)
  @JoinColumn({ name: 'movie_uid' })
  movie: Movie;
}
