const { test, expect } = require('@playwright/test');
const { openAdminTab, uniqueName } = require('../helpers/ui.js');

test.describe('skills tab', () => {
  test.beforeEach(async ({ page }) => {
    page.on('dialog', d => d.accept());
  });

  test('create a public skill, edit it, delete it', async ({ page }) => {
    const name = await uniqueName('skill');

    await openAdminTab(page, 'skills');
    await page.click('button:has-text("+ New Skill")');
    await expect(page.locator('#skillModal')).toHaveClass(/open/);

    await page.fill('#skillName', name);
    await page.fill('#skillDescription', 'a test skill');
    await page.fill('#skillContent', 'do XYZ');
    // No agent checkboxes checked → public
    await page.click('#skillModal .btn-save');
    await expect(page.locator('#skillModal')).not.toHaveClass(/open/);

    const row = page.locator('#skillsTable tr', { hasText: name });
    await expect(row).toContainText('public');

    // Edit
    await row.locator('button:has-text("Edit")').click();
    await page.fill('#skillDescription', 'updated description');
    await page.click('#skillModal .btn-save');
    await expect(page.locator('#skillsTable')).toContainText('updated description');

    // Delete
    await row.locator('button.danger').click();
    await expect(page.locator('#skillsTable')).not.toContainText(name);
  });

  test('assigning agents removes the public badge', async ({ page }) => {
    const skillName = await uniqueName('skill');
    const agentName = await uniqueName('agent');

    // Set up an agent first (via API for speed)
    const a = await page.request.post('/api/agents', { data: { name: agentName, system_prompt: '' } });
    const agentId = (await a.json()).id;

    try {
      await openAdminTab(page, 'skills');
      await page.click('button:has-text("+ New Skill")');
      await page.fill('#skillName', skillName);
      await page.fill('#skillDescription', 'assigned skill');
      // Check the agent in the skill's agent checkboxes
      await page.check(`#skillAgentsCheckboxes input[value="${agentId}"]`);
      await page.click('#skillModal .btn-save');

      const row = page.locator('#skillsTable tr', { hasText: skillName });
      await expect(row).toContainText(agentName);
      await expect(row).not.toContainText('public');
    } finally {
      await page.request.delete(`/api/agents/${agentId}`);
    }
  });
});
