import { agentQuery } from '../db/pool.js';

/**
 * Returns skills available to the given agent:
 * - Skills explicitly assigned to this agent
 * - Skills with no assignments (public)
 */
export async function listSkillsForAgent(agentId) {
  if (!agentId) return [];
  const result = await agentQuery(`
    SELECT s.id, s.name, s.description
    FROM skills s
    LEFT JOIN agent_skills a ON s.id = a.skill_id
    WHERE a.agent_id = $1
       OR NOT EXISTS (SELECT 1 FROM agent_skills WHERE skill_id = s.id)
    ORDER BY s.id
  `, [agentId]);
  return result.rows;
}

export function register(registry) {
  registry.register('read_skill', {
    type: 'function',
    function: {
      name: 'read_skill',
      description: 'Read the full content of a skill by its ID. Skills contain detailed instructions or knowledge for specific tasks. Use this when you see a relevant skill in the available skills list. Example: read_skill({"skill_id": 5}) returns the full text of skill 5.',
      parameters: {
        type: 'object',
        properties: {
          skill_id: { type: 'number', description: 'The ID of the skill to read' },
        },
        required: ['skill_id'],
      },
    },
  }, async ({ skill_id }, context) => {
    const agentId = context?.agentId;
    if (!skill_id) return { error: 'skill_id is required' };

    // Check if skill exists and is accessible to this agent
    const result = await agentQuery(`
      SELECT s.id, s.name, s.description, s.content
      FROM skills s
      WHERE s.id = $1
        AND ($2::int IS NULL OR EXISTS (
          SELECT 1 FROM agent_skills WHERE skill_id = s.id AND agent_id = $2
        ) OR NOT EXISTS (SELECT 1 FROM agent_skills WHERE skill_id = s.id))
    `, [skill_id, agentId || null]);

    if (result.rowCount === 0) return { error: `Skill ${skill_id} not found or not accessible to this agent` };
    return result.rows[0];
  });
}
