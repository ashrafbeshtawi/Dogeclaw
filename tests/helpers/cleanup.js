// Drop all test-created rows. Every entity created by a test should be named
// with the `pw-` prefix so this is a safe, idempotent purge.

const { psql } = require('./db.js');

function clearTestData() {
  psql(`
    DELETE FROM cron_jobs   WHERE description LIKE 'pw-%';
    DELETE FROM sessions    WHERE id LIKE 'pw-%';
    DELETE FROM agent_skills
      WHERE agent_id IN (SELECT id FROM agents WHERE name LIKE 'pw-%')
         OR skill_id IN (SELECT id FROM skills WHERE name LIKE 'pw-%');
    DELETE FROM channels    WHERE name LIKE 'pw-%';
    DELETE FROM agents      WHERE name LIKE 'pw-%';
    DELETE FROM skills      WHERE name LIKE 'pw-%';
    DELETE FROM models      WHERE name LIKE 'pw-%';
  `);
}

module.exports = { clearTestData };
