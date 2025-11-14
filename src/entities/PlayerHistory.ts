import { Entity, PrimaryGeneratedColumn, Column } from 'typeorm';

@Entity('player_history')
export class PlayerHistory {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: 'text', nullable: true })
  campaign_id!: string | null;

  @Column({ type: 'datetime', nullable: true })
  date!: Date | null;

  @Column({ type: 'text', nullable: true })
  action!: string | null;

  @Column({ type: 'text', nullable: true })
  campaign_session_id!: string | null;

  @Column({ type: 'text', nullable: true })
  content_id!: string | null;

  @Column({ type: 'text', nullable: true })
  content_session_id!: string | null;

  @Column({ type: 'text', nullable: true })
  content_title!: string | null;

  @Column({ type: 'text', nullable: true })
  device_id!: string | null;

  @Column({ type: 'real', nullable: true })
  duration_second!: number | null;

  @Column({ type: 'text', nullable: true })
  inventory_id!: string | null;

  @Column({ type: 'text', nullable: true })
  iso_local_time!: string | null;

  @Column({ type: 'text', nullable: true })
  iso_time!: string | null;

  @Column({ type: 'text', nullable: true })
  player_version!: string | null;

  @Column({ type: 'text', nullable: true })
  pricing_rule!: string | null;

  @Column({ type: 'real', nullable: true })
  content_duration!: number | null;

  @Column({ type: 'text', nullable: true })
  content_selection!: string | null;

  @Column({ type: 'integer', nullable: true })
  content_version!: number | null;

  @Column({ type: 'real', nullable: true })
  elapsed_second!: number | null;

  @Column({ type: 'datetime', nullable: true })
  playlist_created_time!: Date | null;

  @Column({ type: 'text', nullable: true })
  sequence_id!: string | null;

  @Column({ type: 'text', nullable: true })
  advertiser_id!: string | null;

  @Column({ type: 'date', nullable: true })
  iso_time_date!: Date | null;

  @Column({ type: 'date', nullable: true })
  part_date!: Date | null;
}

