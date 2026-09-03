// Handlers for the agent-facing skill management tools. Dependency-free —
// the query function is injected — so the stdlib-only unit tests (CI runs
// them without npm install) can exercise the ownership logic directly.
//
// Ownership model: created_by_agent_id marks who may edit/delete a skill.
// Admin-created skills (NULL) are read-only for agents. These handlers run
// on the ADMIN connection; the restricted dogeclaw role stays SELECT-only
// on skills, so the agent's raw SQL tool cannot bypass these checks.
export function makeSkillHandlers(query) {
  return {
    async createSkill({ name, description = '', content = '' }, context) {
      const agentId = context?.agentId;
      if (!agentId) return { error: 'Skill management requires an agent context' };
      if (!name) return { error: 'name is required' };
      const res = await query(
        `INSERT INTO skills (name, description, content, created_by_agent_id)
         VALUES ($1, $2, $3, $4) RETURNING id, name, description`,
        [name, description, content, agentId],
      );
      const skill = res.rows[0];
      // Auto-assign to the creator: an assigned skill is private to its
      // agents, so a fresh agent-created skill never leaks as "public".
      await query(
        'INSERT INTO agent_skills (agent_id, skill_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
        [agentId, skill.id],
      );
      return skill;
    },

    async updateSkill({ skill_id, name, description, content }, context) {
      const agentId = context?.agentId;
      if (!agentId) return { error: 'Skill management requires an agent context' };
      if (!skill_id) return { error: 'skill_id is required' };
      const res = await query(
        `UPDATE skills SET
           name = COALESCE($1, name),
           description = COALESCE($2, description),
           content = COALESCE($3, content)
         WHERE id = $4 AND created_by_agent_id = $5
         RETURNING id, name, description`,
        [name ?? null, description ?? null, content ?? null, skill_id, agentId],
      );
      if (res.rowCount === 0) return { error: `Skill ${skill_id} not found or not created by you — you can only edit skills you created` };
      return res.rows[0];
    },

    async deleteSkill({ skill_id }, context) {
      const agentId = context?.agentId;
      if (!agentId) return { error: 'Skill management requires an agent context' };
      if (!skill_id) return { error: 'skill_id is required' };
      const res = await query(
        'DELETE FROM skills WHERE id = $1 AND created_by_agent_id = $2',
        [skill_id, agentId],
      );
      if (res.rowCount === 0) return { error: `Skill ${skill_id} not found or not created by you — you can only delete skills you created` };
      return { ok: true, deleted: skill_id };
    },
  };
}
