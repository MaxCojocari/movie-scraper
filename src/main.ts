import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe, ValidationPipeOptions } from '@nestjs/common';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  const validationPipeOptions: ValidationPipeOptions = {
    forbidNonWhitelisted: true,
    whitelist: true,
    transform: true,
    transformOptions: {
      enableImplicitConversion: true,
    },
  };

  app.useGlobalPipes(new ValidationPipe(validationPipeOptions));

  await app.listen(process.env.PORT ?? 3000);
}
bootstrap();
