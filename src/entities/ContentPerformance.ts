import { Entity, PrimaryGeneratedColumn, Column } from 'typeorm';

@Entity('content_performance')
export class ContentPerformance {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: 'text' })
  content_id!: string;

  @Column({ type: 'text', nullable: true })
  title!: string | null;

  @Column({ type: 'text', nullable: true })
  audience_id!: string | null;

  @Column({ type: 'text', nullable: true })
  age!: string | null;

  @Column({ type: 'text', nullable: true })
  gender!: string | null;

  @Column({ type: 'datetime', nullable: true })
  play_at!: Date | null;

  @Column({ type: 'real', nullable: true })
  attention_sec!: number | null;

  @Column({ type: 'boolean', nullable: true })
  is_attention!: boolean | null;

  @Column({ type: 'boolean', nullable: true })
  is_entrance!: boolean | null;

  @Column({ type: 'text', nullable: true })
  content_group!: string | null;
}

