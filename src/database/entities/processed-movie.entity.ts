import { Entity, Index, PrimaryGeneratedColumn, Column } from 'typeorm';

@Entity('processed_users')
@Index(['userUid'], { unique: true })
export class ProcessedUser {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ name: 'user_uid' })
  userUid: string;

  @Column({
    name: 'processed_at',
    type: 'timestamp',
    default: () => 'CURRENT_TIMESTAMP',
  })
  processedAt: Date;

  @Column({ name: 'reviews_scraped', type: 'int', default: 0 })
  reviewsScraped: number;
}
