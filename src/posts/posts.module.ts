import { Module } from '@nestjs/common';
import { PostTemplateService } from './post-template.service';

@Module({
  providers: [PostTemplateService],
  exports: [PostTemplateService],
})
export class PostsModule {}
