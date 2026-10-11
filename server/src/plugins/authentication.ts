import { and, eq } from 'drizzle-orm';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import { users } from '../schema/users.js';

async function authenticationPlugin(app: FastifyInstance): Promise<void> {
  app.decorate(
    'authenticate',
    async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
      const claims = await request.jwtVerify<{ sub: string; type: 'access' }>();
      if (claims.type !== 'access') {
        reply.code(401).send({ error: 'Unauthorized' });
        return;
      }

      const [user] = await app.db
        .select({ id: users.id })
        .from(users)
        .where(and(eq(users.id, claims.sub), eq(users.isActive, true)))
        .limit(1);

      if (user === undefined) {
        reply.code(401).send({ error: 'Unauthorized' });
      }
    },
  );
}

export default fp(authenticationPlugin, { name: 'authentication' });
