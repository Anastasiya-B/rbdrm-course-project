import {
  Check,
  Column,
  Entity,
  Index,
  OneToMany,
  PrimaryGeneratedColumn,
} from 'typeorm';

import { Order } from './order.entity';
import { Product } from './product.entity';

@Entity({ name: 'users' })
@Index('idx_users_lower_email', { synchronize: false })
@Check('users_email_not_empty', 'length(trim(email)) > 0')
@Check('users_full_name_not_empty', 'length(trim(full_name)) > 0')
@Check('users_balance_non_negative', 'balance >= 0')
export class User {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id!: string;

  @Column({ type: 'text', unique: true })
  email!: string;

  @Column({ name: 'full_name', type: 'text' })
  fullName!: string;

  @Column({
    type: 'integer',
    default: 0,
    comment: 'Balance in minor currency units',
  })
  balance!: number;

  @Column({
    name: 'created_at',
    type: 'timestamptz',
    default: () => 'CURRENT_TIMESTAMP',
  })
  createdAt!: Date;

  @OneToMany(() => Product, product => product.owner)
  products!: Product[];

  @OneToMany(() => Order, order => order.user)
  orders!: Order[];
}
