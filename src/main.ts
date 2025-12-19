import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ScraperService } from './scraper/scraper.service';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  const scraperService = app.get(ScraperService);
  console.log('ScraperService#getHello:', scraperService.getHello());

  await app.close();
}
bootstrap();
