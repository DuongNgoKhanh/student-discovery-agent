import { Hono } from 'hono';
import { honoHandler, withHandler } from '@/http/handler';
import { success } from '@/http/response';
import { registerAuthRoutes } from '@/modules/auth/auth.routes';
import { registerAgentRoutes } from '@/modules/agent/agent.routes';
import { registerConversationRoutes } from '@/modules/conversations/conversations.routes';
import { registerExperiencesRoutes } from '@/modules/experiences/experiences.routes';
import { registerKnowledgeRoutes } from '@/modules/knowledge/knowledge.routes';
import { registerUsersRoutes } from '@/modules/users/users.routes';
import { registerVersionsRoutes } from '@/modules/versions/versions.routes';
import { probeReadiness, readinessResponse, type ReadinessSnapshot } from '@/health/readiness';

export interface AppOptions {
  readiness?: () => Promise<ReadinessSnapshot>;
}

export function createApp(options: AppOptions = {}): Hono {
  const app = new Hono();
  const health = withHandler(async (_req, ctx) => success({ status: 'ok' }, ctx));
  app.get('/api/health', honoHandler(health));
  const ready = withHandler(async () => readinessResponse(await (options.readiness ?? probeReadiness)()));
  app.get('/api/ready', honoHandler(ready));
  app.get('/ready', honoHandler(ready));
  registerAuthRoutes(app);
  registerAgentRoutes(app);
  registerConversationRoutes(app);
  registerExperiencesRoutes(app);
  registerKnowledgeRoutes(app);
  registerUsersRoutes(app);
  registerVersionsRoutes(app);
  return app;
}
