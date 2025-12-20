import { Entity, Column, PrimaryGeneratedColumn } from 'typeorm';

@Entity()
export class Review {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ name: 'user_uid' })
  userUid: string;

  @Column({ name: 'movie_uid' })
  movieUid: string;

  @Column({ name: 'rating', type: 'int', nullable: true })
  rating: number;

  @Column({ name: 'review_text', type: 'text' })
  reviewText: string;
}
