import pool from '../config/database.js';

async function addTestProspects() {
  try {
    console.log('Connected to PostgreSQL database');

    // Get a test user (Corporate Admin)
    const userResult = await pool.query(
      `SELECT u.id as user_id, tu.id as tallac_user_id 
       FROM users u
       JOIN tallac_users tu ON u.id = tu.user_id
       WHERE u.email = 'corporate.admin@tallac.com'
       LIMIT 1`
    );

    if (userResult.rows.length === 0) {
      console.error('Test user not found. Please run create-test-users.js first.');
      process.exit(1);
    }

    const testUserId = userResult.rows[0].user_id;
    const testTallacUserId = userResult.rows[0].tallac_user_id;

    // Get a territory
    const territoryResult = await pool.query(
      `SELECT id FROM tallac_territories LIMIT 1`
    );

    if (territoryResult.rows.length === 0) {
      console.error('No territory found. Please create a territory first.');
      process.exit(1);
    }

    const territoryId = territoryResult.rows[0].id;

    // Get or create industries
    const industries = [
      { code: 'TECH', name: 'Technology' },
      { code: 'HEALTH', name: 'Healthcare' },
      { code: 'FIN', name: 'Finance' },
      { code: 'EDU', name: 'Education' },
      { code: 'MANUF', name: 'Manufacturing' },
    ];

    const industryMap = {};
    for (const industry of industries) {
      let industryResult = await pool.query(
        `SELECT id FROM tallac_industries WHERE industry_code = $1 OR industry_name = $2`,
        [industry.code, industry.name]
      );

      if (industryResult.rows.length === 0) {
        industryResult = await pool.query(
          `INSERT INTO tallac_industries (industry_code, industry_name) 
           VALUES ($1, $2) RETURNING id`,
          [industry.code, industry.name]
        );
      }

      industryMap[industry.code] = industryResult.rows[0].id;
    }

    // Test prospects data
    const prospects = [
      {
        company_name: 'Acme Corporation',
        industry: 'Technology',
        industry_code: 'TECH',
        status: 'Contacted',
        city: 'San Francisco',
        state: 'CA',
        zip_code: '94102',
        address: '123 Market Street',
        overview: 'Leading technology company specializing in cloud solutions.',
        employee_size: '500-1000',
        revenue: '$50M-$100M',
      },
      {
        company_name: 'MedTech Solutions Inc',
        industry: 'Healthcare',
        industry_code: 'HEALTH',
        status: 'Interested',
        city: 'Boston',
        state: 'MA',
        zip_code: '02101',
        address: '456 Medical Drive',
        overview: 'Healthcare technology provider focused on patient care systems.',
        employee_size: '200-500',
        revenue: '$20M-$50M',
      },
      {
        company_name: 'Global Finance Group LLC',
        industry: 'Finance',
        industry_code: 'FIN',
        status: 'Proposal',
        city: 'New York',
        state: 'NY',
        zip_code: '10001',
        address: '789 Wall Street',
        overview: 'Financial services firm offering investment and advisory services.',
        employee_size: '1000+',
        revenue: '$100M+',
      },
      {
        company_name: 'EduTech Innovations',
        industry: 'Education',
        industry_code: 'EDU',
        status: 'New',
        city: 'Austin',
        state: 'TX',
        zip_code: '78701',
        address: '321 Learning Avenue',
        overview: 'Educational technology company developing e-learning platforms.',
        employee_size: '50-200',
        revenue: '$5M-$20M',
      },
      {
        company_name: 'Industrial Manufacturing Company',
        industry: 'Manufacturing',
        industry_code: 'MANUF',
        status: 'Contacted',
        city: 'Detroit',
        state: 'MI',
        zip_code: '48201',
        address: '654 Factory Road',
        overview: 'Manufacturing company producing industrial equipment.',
        employee_size: '500-1000',
        revenue: '$50M-$100M',
      },
      {
        company_name: 'TechStart Ventures',
        industry: 'Technology',
        industry_code: 'TECH',
        status: 'Interested',
        city: 'Seattle',
        state: 'WA',
        zip_code: '98101',
        address: '987 Innovation Boulevard',
        overview: 'Startup technology company focused on AI and machine learning.',
        employee_size: '10-50',
        revenue: '$1M-$5M',
      },
      {
        company_name: 'HealthCare Plus Systems',
        industry: 'Healthcare',
        industry_code: 'HEALTH',
        status: 'Proposal',
        city: 'Chicago',
        state: 'IL',
        zip_code: '60601',
        address: '147 Health Plaza',
        overview: 'Healthcare management systems provider.',
        employee_size: '200-500',
        revenue: '$20M-$50M',
      },
      {
        company_name: 'Financial Advisors Incorporated',
        industry: 'Finance',
        industry_code: 'FIN',
        status: 'New',
        city: 'Los Angeles',
        state: 'CA',
        zip_code: '90001',
        address: '258 Finance Street',
        overview: 'Financial advisory firm providing wealth management services.',
        employee_size: '50-200',
        revenue: '$10M-$20M',
      },
    ];

    console.log('\nAdding test prospects...\n');

    for (const prospect of prospects) {
      // Create or get organization
      let orgResult = await pool.query(
        `SELECT id FROM tallac_organizations WHERE organization_name = $1`,
        [prospect.company_name]
      );

      let organizationId;
      if (orgResult.rows.length === 0) {
        orgResult = await pool.query(
          `INSERT INTO tallac_organizations 
           (organization_name, industry, industry_id, address_line_1, city, state, zip_code, territory_id, overview, employee_size, revenue, organization_owner_id, status)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'Prospect')
           RETURNING id`,
          [
            prospect.company_name,
            prospect.industry,
            industryMap[prospect.industry_code],
            prospect.address,
            prospect.city,
            prospect.state,
            prospect.zip_code,
            territoryId,
            prospect.overview,
            prospect.employee_size,
            prospect.revenue,
            testUserId,
          ]
        );
        organizationId = orgResult.rows[0].id;
        console.log(`✓ Created organization: ${prospect.company_name}`);
      } else {
        organizationId = orgResult.rows[0].id;
        console.log(`✓ Organization exists: ${prospect.company_name}`);
      }

      // Create prospect (prospect_code is auto-generated by trigger)
      const prospectResult = await pool.query(
        `INSERT INTO tallac_prospects 
         (organization_id, status, assigned_to_id, created_by_id)
         VALUES ($1, $2, $3, $4)
         RETURNING id, prospect_code`,
        [organizationId, prospect.status, testUserId, testUserId]
      );

      const prospectId = prospectResult.rows[0].id;
      console.log(`✓ Created prospect: ${prospectResult.rows[0].prospect_code} - ${prospect.company_name} (${prospect.status})`);

      // Get activity status IDs
      const statusIds = {};
      const statusResult = await pool.query(`SELECT id, status_name FROM activity_statuses`);
      for (const row of statusResult.rows) {
        statusIds[row.status_name] = row.id;
      }

      // Add recent activities (completed)
      const recentActivities = [
        {
          type: 'Call Log',
          subject: 'Initial Contact Call',
          description: `Initial call with ${prospect.company_name} to discuss their needs.`,
          call_outcome: 'Interested',
          daysAgo: 5,
        },
        {
          type: 'Notes',
          subject: 'Follow-up Notes',
          description: `Follow-up discussion about ${prospect.company_name}'s requirements.`,
          daysAgo: 3,
        },
        {
          type: 'Call Log',
          subject: 'Product Demo Call',
          description: `Conducted product demonstration for ${prospect.company_name}.`,
          call_outcome: 'Positive Response',
          daysAgo: 1,
        },
      ];

      // Get next activity code
      const activityCodeResult = await pool.query(
        `SELECT COALESCE(MAX(CAST(SUBSTRING(name FROM 'TACT-(\\d+)') AS INTEGER)), 0) + 1 as next_num
         FROM tallac_activities WHERE name LIKE 'TACT-%'`
      );
      let nextActivityNum = activityCodeResult.rows[0]?.next_num || 1;

      for (const activity of recentActivities) {
        const completedDate = new Date();
        completedDate.setDate(completedDate.getDate() - activity.daysAgo);
        completedDate.setHours(10 + Math.floor(Math.random() * 8), Math.floor(Math.random() * 60), 0, 0);

        const activityCode = `TACT-${String(nextActivityNum).padStart(5, '0')}`;
        nextActivityNum++;

        const scheduledTime = `${String(completedDate.getHours()).padStart(2, '0')}:${String(completedDate.getMinutes()).padStart(2, '0')}:00`;

        await pool.query(
          `INSERT INTO tallac_activities 
           (name, activity_type, title, status_id, reference_docname, reference_doctype, organization_id,
            description, assigned_to_id, created_by_id, created_at, completed_on, outcome_status, scheduled_date, scheduled_time)
           VALUES ($1, $2, $3, $4, $5, 'Prospect', $6, $7, $8, $9, $10, $11, $12, $13, $14)
           RETURNING id`,
          [
            activityCode,
            activity.type,
            activity.subject,
            statusIds['Completed'] || statusIds['Open'],
            prospectId,
            organizationId,
            activity.description,
            testUserId,
            testUserId,
            completedDate,
            completedDate,
            activity.call_outcome || null,
            completedDate, // Use completed date as scheduled_date for completed activities
            scheduledTime,
          ]
        );
      }

      // Add scheduled activities (open/in progress)
      const scheduledActivities = [
        {
          type: 'Callback',
          subject: 'Follow-up Callback',
          description: `Schedule follow-up callback with ${prospect.company_name}.`,
          daysFromNow: 2,
          time: '14:00:00',
        },
        {
          type: 'Appointment',
          subject: 'Product Presentation',
          description: `Schedule product presentation meeting with ${prospect.company_name}.`,
          daysFromNow: 5,
          time: '15:30:00',
        },
      ];

      for (const activity of scheduledActivities) {
        const scheduledDate = new Date();
        scheduledDate.setDate(scheduledDate.getDate() + activity.daysFromNow);
        scheduledDate.setHours(0, 0, 0, 0);

        const activityCode = `TACT-${String(nextActivityNum).padStart(5, '0')}`;
        nextActivityNum++;

        await pool.query(
          `INSERT INTO tallac_activities 
           (name, activity_type, title, status_id, reference_docname, reference_doctype, organization_id,
            description, assigned_to_id, created_by_id, scheduled_date, scheduled_time, created_at)
           VALUES ($1, $2, $3, $4, $5, 'Prospect', $6, $7, $8, $9, $10, $11, CURRENT_TIMESTAMP)
           RETURNING id`,
          [
            activityCode,
            activity.type,
            activity.subject,
            statusIds['Open'] || statusIds['In Progress'],
            prospectId,
            organizationId,
            activity.description,
            testUserId,
            testUserId,
            scheduledDate,
            activity.time,
          ]
        );
      }

      console.log(`  ✓ Added 3 recent activities and 2 scheduled activities`);
    }

    console.log('\n✅ All test prospects with activities added successfully!');
    await pool.end();
  } catch (error) {
    console.error('Error:', error.message);
    console.error(error);
    process.exit(1);
  }
}

addTestProspects();

