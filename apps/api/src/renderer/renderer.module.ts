import { Global, Module } from '@nestjs/common';
import { RendererService } from './renderer.service';

/** Server-side diagram images and PDF (internal renderer container, D-172). */
@Global()
@Module({ providers: [RendererService], exports: [RendererService] })
export class RendererModule {}
