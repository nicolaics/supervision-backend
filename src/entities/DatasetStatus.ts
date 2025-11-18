import { Entity, PrimaryGeneratedColumn, Column, Unique, CreateDateColumn, UpdateDateColumn } from 'typeorm';

@Entity('dataset_status')
@Unique(['dataset_name'])
export class DatasetStatus {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: 'text' })
  dataset_name!: string;

  @Column({ type: 'integer', default: 0 })
  records_count!: number;

  @Column({ type: 'datetime', nullable: true })
  last_updated_at!: Date | null;

  @CreateDateColumn({ type: 'datetime', default: () => "CURRENT_TIMESTAMP" })
  created_at!: Date;

  @UpdateDateColumn({ type: 'datetime', default: () => "CURRENT_TIMESTAMP" })
  updated_at!: Date;
}


