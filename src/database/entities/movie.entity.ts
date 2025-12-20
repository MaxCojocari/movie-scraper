import { Entity, Column, PrimaryColumn } from 'typeorm';

@Entity()
export class Movie {
  @PrimaryColumn({ name: 'movie_uid' })
  movieUid: string; // slug like "parasite-2019"

  @Column({ name: 'movie_name' })
  movieName: string;

  @Column({ name: 'release_year', type: 'int' })
  releaseYear: number;

  @Column({ name: 'watched_by', type: 'int' })
  watchedBy: number;

  @Column({ name: 'avg_rating', type: 'decimal', precision: 3, scale: 2 })
  avgRating: number;

  @Column({ name: 'synopsis', type: 'text' })
  synopsis: string;

  @Column({ name: 'genres', type: 'text' })
  genres: string; // comma-separated

  @Column({ name: 'themes', type: 'text' })
  themes: string; // pipe-separated

  @Column({ name: 'director', type: 'text' })
  director: string; // comma-separated

  @Column({ name: 'cast', type: 'text' })
  cast: string; // comma-separated (first 10)
}
