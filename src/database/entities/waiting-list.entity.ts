import { Entity, Column, PrimaryGeneratedColumn, Index } from 'typeorm';

@Entity('waiting_list')
@Index(['movieId'], { unique: true })
@Index(['priority'])
export class WaitingList {
  @PrimaryGeneratedColumn({ name: 'id' })
  id: number;

  @Column({ name: 'movie_uid' })
  movieId: string;

  @Column({ name: 'priority', type: 'bigint' })
  priority: number;
}
