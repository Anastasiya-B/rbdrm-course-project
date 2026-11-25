import {
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';

import { createLogger } from './logger';
import {
  ObservabilityOrdersRepository,
  type ObservabilityOrder,
} from './orders.repository';

@Injectable()
export class ObservabilityService {
  private readonly logger = createLogger('orders.service');

  constructor(private readonly repository: ObservabilityOrdersRepository) {}

  async findOrder(
    id: number,
    forceFailure: boolean,
  ): Promise<ObservabilityOrder> {
    this.logger.info(
      {
        orderId: id,
      },
      'service lookup',
    );

    const order = await this.repository.findById(id);

    if (!order) {
      throw new NotFoundException(`Order ${id} not found`);
    }

    if (forceFailure) {
      this.logger.error(
        {
          orderId: id,
        },
        'forced observability failure',
      );

      throw new InternalServerErrorException('Observability demo failure');
    }

    return order;
  }
}
