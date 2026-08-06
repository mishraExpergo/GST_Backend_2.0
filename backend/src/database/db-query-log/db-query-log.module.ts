import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DbQueryLog } from '../../entities/db-query-log.entity';
import { DbQueryLogService } from './db-query-log.service';

@Global()
@Module({
  imports: [TypeOrmModule.forFeature([DbQueryLog])],
  providers: [DbQueryLogService],
  exports: [DbQueryLogService],
})
export class DbQueryLogModule {}
