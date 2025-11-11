import { pool } from '../config/database';

async function seedDatabase() {
  try {
    console.log('🌱 Seeding database with comprehensive test data...');

    // Insert activity statuses first
    await pool.query(`
      INSERT INTO activity_statuses (status_name, description)
      VALUES 
        ('Open', 'Activity is open and pending'),
        ('Completed', 'Activity has been completed'),
        ('Cancelled', 'Activity has been cancelled'),
        ('In Progress', 'Activity is in progress')
      ON CONFLICT (status_name) DO NOTHING
    `);
    console.log('✅ Activity statuses ready');

    // Insert call statuses
    await pool.query(`
      INSERT INTO call_statuses (status_name, description)
      VALUES 
        ('Connected', 'Call was connected'),
        ('No Answer', 'Call was not answered'),
        ('Busy', 'Line was busy'),
        ('Failed', 'Call failed')
      ON CONFLICT (status_name) DO NOTHING
    `);
    console.log('✅ Call statuses ready');

    // Insert test users
    const usersResult = await pool.query(`
      INSERT INTO users (email, "firstName", "lastName", "passwordHash", role, active, first_name, last_name, full_name, password_hash, is_active)
      VALUES 
        ('admin@tallac.io', 'Admin', 'User', '$2b$10$dummyhash', 'Sales User', true, 'Admin', 'User', 'Admin User', '$2b$10$dummyhash', true),
        ('calvin@email.com', 'Calvin', 'M.', '$2b$10$dummyhash', 'Sales User', true, 'Calvin', 'M.', 'Calvin M.', '$2b$10$dummyhash', true),
        ('shruti@email.com', 'Shruti', 'K.', '$2b$10$dummyhash', 'Sales User', true, 'Shruti', 'K.', 'Shruti K.', '$2b$10$dummyhash', true),
        ('john.doe@tallac.io', 'John', 'Doe', '$2b$10$dummyhash', 'Sales User', true, 'John', 'Doe', 'John Doe', '$2b$10$dummyhash', true),
        ('jane.smith@tallac.io', 'Jane', 'Smith', '$2b$10$dummyhash', 'Sales User', true, 'Jane', 'Smith', 'Jane Smith', '$2b$10$dummyhash', true)
      ON CONFLICT (email) DO NOTHING
      RETURNING id, email, full_name
    `);
    console.log(`✅ Inserted ${usersResult.rows.length} users`);

    // Get user IDs
    const adminUser = await pool.query("SELECT id FROM users WHERE email = 'admin@tallac.io'");
    const calvinUser = await pool.query("SELECT id FROM users WHERE email = 'calvin@email.com'");
    const shrutiUser = await pool.query("SELECT id FROM users WHERE email = 'shruti@email.com'");
    const johnUser = await pool.query("SELECT id FROM users WHERE email = 'john.doe@tallac.io'");
    const janeUser = await pool.query("SELECT id FROM users WHERE email = 'jane.smith@tallac.io'");
    const adminId = adminUser.rows[0]?.id;
    const calvinId = calvinUser.rows[0]?.id;
    const shrutiId = shrutiUser.rows[0]?.id;
    const johnId = johnUser.rows[0]?.id;
    const janeId = janeUser.rows[0]?.id;

    // Insert territories
    const territoriesResult = await pool.query(`
      INSERT INTO tallac_territories (territory_name, description)
      VALUES 
        ('Oregon', 'Oregon Territory'),
        ('Washington', 'Washington Territory'),
        ('California', 'California Territory'),
        ('Florida', 'Florida Territory'),
        ('Texas', 'Texas Territory'),
        ('Colorado', 'Colorado Territory'),
        ('Georgia', 'Georgia Territory'),
        ('Illinois', 'Illinois Territory'),
        ('Arizona', 'Arizona Territory')
      ON CONFLICT DO NOTHING
      RETURNING id, territory_name
    `);
    console.log(`✅ Inserted ${territoriesResult.rows.length} territories`);

    // Get territory IDs
    const getTerritoryId = async (name: string) => {
      const result = await pool.query("SELECT id FROM tallac_territories WHERE territory_name = $1", [name]);
      return result.rows[0]?.id;
    };

    // Insert organizations (matching company names from prospects)
    const orgsResult = await pool.query(`
      INSERT INTO tallac_organizations (organization_name, description)
      VALUES 
        ('Northern Logistics', 'Logistics and Transportation Company'),
        ('Summit Logistics', 'Summit Logistics Services'),
        ('Pacific Transport', 'Pacific Transportation Services'),
        ('Coastal Carriers', 'Coastal Shipping Carriers'),
        ('Eagle Freight', 'Eagle Freight Services'),
        ('Mountain Express', 'Mountain Express Delivery'),
        ('Harbor Shipping', 'Harbor Shipping Company'),
        ('Continental Freight', 'Continental Freight Forwarding'),
        ('West Coast Transport', 'West Coast Transportation'),
        ('Mountain Freight', 'Mountain Freight Services'),
        ('Coastal Logistics', 'Coastal Logistics Solutions'),
        ('Fast Track Delivery', 'Fast Track Delivery Services')
      ON CONFLICT DO NOTHING
      RETURNING id, organization_name
    `);
    console.log(`✅ Inserted ${orgsResult.rows.length} organizations`);

    // Get organization IDs
    const getOrgId = async (name: string) => {
      const result = await pool.query("SELECT id FROM tallac_organizations WHERE organization_name = $1", [name]);
      return result.rows[0]?.id;
    };

    // Insert contacts
    const contactsData = [
      { name: 'Emily Chen', org: 'Northern Logistics', title: 'Director of Logistics', email: 'emily@northernlogistics.com', phone: '555-8001' },
      { name: 'Jane Doe', org: 'Summit Logistics', title: 'Operations Director', email: 'contact@summitlogistics.com', phone: '555-2077' },
      { name: 'John Smith', org: 'Pacific Transport', title: 'CEO', email: 'john@pacifictransport.com', phone: '555-3001' },
      { name: 'Sarah Johnson', org: 'Coastal Carriers', title: 'VP Operations', email: 'sarah@coastalcarriers.com', phone: '555-4001' },
      { name: 'Michael Brown', org: 'Eagle Freight', title: 'Regional Manager', email: 'michael@eaglefreight.com', phone: '555-5001' },
      { name: 'Robert Wilson', org: 'Mountain Express', title: 'Logistics Coordinator', email: 'robert@mountainexpress.com', phone: '555-6001' },
      { name: 'Lisa Martinez', org: 'Harbor Shipping', title: 'Procurement Manager', email: 'lisa@harborshipping.com', phone: '555-7001' },
      { name: 'David Lee', org: 'Continental Freight', title: 'Business Development', email: 'david@continentalfreight.com', phone: '555-8001' },
    ];

    for (const contact of contactsData) {
      const orgId = await getOrgId(contact.org);
      await pool.query(`
        INSERT INTO tallac_contacts (full_name, first_name, last_name, job_title, email, phone, organization_id)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        ON CONFLICT DO NOTHING
      `, [
        contact.name,
        contact.name.split(' ')[0],
        contact.name.split(' ')[1] || '',
        contact.title,
        contact.email,
        contact.phone,
        orgId,
      ]);
    }
    console.log(`✅ Inserted ${contactsData.length} contacts`);

    // Calculate dates for queue status
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const nextWeek = new Date(today);
    nextWeek.setDate(nextWeek.getDate() + 7);
    const lastWeek = new Date(today);
    lastWeek.setDate(lastWeek.getDate() - 7);

    // Get all territory and organization IDs first
    const oregonId = await getTerritoryId('Oregon');
    const washingtonId = await getTerritoryId('Washington');
    const californiaId = await getTerritoryId('California');
    const coloradoId = await getTerritoryId('Colorado');
    const georgiaId = await getTerritoryId('Georgia');
    const illinoisId = await getTerritoryId('Illinois');
    const floridaId = await getTerritoryId('Florida');
    const arizonaId = await getTerritoryId('Arizona');

    const northernOrgId = await getOrgId('Northern Logistics');
    const summitOrgId = await getOrgId('Summit Logistics');
    const pacificOrgId = await getOrgId('Pacific Transport');
    const coastalCarriersOrgId = await getOrgId('Coastal Carriers');
    const eagleOrgId = await getOrgId('Eagle Freight');
    const mountainExpressOrgId = await getOrgId('Mountain Express');
    const harborOrgId = await getOrgId('Harbor Shipping');
    const continentalOrgId = await getOrgId('Continental Freight');
    const westCoastOrgId = await getOrgId('West Coast Transport');
    const mountainFreightOrgId = await getOrgId('Mountain Freight');
    const coastalLogisticsOrgId = await getOrgId('Coastal Logistics');
    const fastTrackOrgId = await getOrgId('Fast Track Delivery');

    // Insert comprehensive leads/prospects with queue statuses
    const leadsData = [
      // Queue: Overdue (callback_date < today)
      {
        name: 'TLEAD-00001',
        company_name: 'Northern Logistics',
        industry: 'Distribution',
        status: 'New',
        lead_owner_id: calvinId,
        assigned_to_id: calvinId,
        primary_contact_name: 'Emily Chen',
        primary_title: 'Director of Logistics',
        primary_phone: '555-8001',
        primary_email: 'emily@northernlogistics.com',
        city: 'Portland',
        state: 'OR',
        zip_code: '97201',
        territory_id: oregonId,
        organization_id: northernOrgId,
        callback_date: yesterday.toISOString().split('T')[0],
        callback_time: '14:00:00',
      },
      {
        name: 'TLEAD-00002',
        company_name: 'Summit Logistics',
        industry: 'Warehousing',
        status: 'Contacted',
        lead_owner_id: shrutiId,
        assigned_to_id: shrutiId,
        primary_contact_name: 'Jane Doe',
        primary_title: 'Operations Director',
        primary_phone: '555-2077',
        primary_email: 'contact@summitlogistics.com',
        city: 'Denver',
        state: 'CO',
        zip_code: '80202',
        territory_id: coloradoId,
        organization_id: summitOrgId,
        callback_date: lastWeek.toISOString().split('T')[0],
        callback_time: '10:00:00',
      },
      // Queue: Today (callback_date = today)
      {
        name: 'TLEAD-00003',
        company_name: 'Pacific Transport',
        industry: 'Logistics',
        status: 'Proposal',
        lead_owner_id: calvinId,
        assigned_to_id: calvinId,
        primary_contact_name: 'John Smith',
        primary_title: 'CEO',
        primary_phone: '555-3001',
        primary_email: 'john@pacifictransport.com',
        city: 'Los Angeles',
        state: 'CA',
        zip_code: '90001',
        territory_id: californiaId,
        organization_id: pacificOrgId,
        callback_date: today.toISOString().split('T')[0],
        callback_time: '15:00:00',
      },
      {
        name: 'TLEAD-00004',
        company_name: 'Coastal Carriers',
        industry: 'Shipping',
        status: 'Interested',
        lead_owner_id: johnId,
        assigned_to_id: johnId,
        primary_contact_name: 'Sarah Johnson',
        primary_title: 'VP Operations',
        primary_phone: '555-4001',
        primary_email: 'sarah@coastalcarriers.com',
        city: 'San Diego',
        state: 'CA',
        zip_code: '92101',
        territory_id: californiaId,
        organization_id: coastalCarriersOrgId,
        callback_date: today.toISOString().split('T')[0],
        callback_time: '16:00:00',
      },
      // Queue: Scheduled (callback_date > today)
      {
        name: 'TLEAD-00005',
        company_name: 'Eagle Freight',
        industry: 'Air Cargo',
        status: 'Won',
        lead_owner_id: shrutiId,
        assigned_to_id: shrutiId,
        primary_contact_name: 'Michael Brown',
        primary_title: 'Regional Manager',
        primary_phone: '555-5001',
        primary_email: 'michael@eaglefreight.com',
        city: 'Atlanta',
        state: 'GA',
        zip_code: '30301',
        territory_id: georgiaId,
        organization_id: eagleOrgId,
        callback_date: tomorrow.toISOString().split('T')[0],
        callback_time: '11:00:00',
      },
      {
        name: 'TLEAD-00006',
        company_name: 'Mountain Express',
        industry: 'Express Delivery',
        status: 'New',
        lead_owner_id: calvinId,
        assigned_to_id: calvinId,
        primary_contact_name: 'Robert Wilson',
        primary_title: 'Logistics Coordinator',
        primary_phone: '555-6001',
        primary_email: 'robert@mountainexpress.com',
        city: 'Denver',
        state: 'CO',
        zip_code: '80201',
        territory_id: coloradoId,
        organization_id: mountainExpressOrgId,
        callback_date: nextWeek.toISOString().split('T')[0],
        callback_time: '09:00:00',
      },
      {
        name: 'TLEAD-00007',
        company_name: 'Harbor Shipping',
        industry: 'Maritime Shipping',
        status: 'Contacted',
        lead_owner_id: calvinId,
        assigned_to_id: calvinId,
        primary_contact_name: 'Lisa Martinez',
        primary_title: 'Procurement Manager',
        primary_phone: '555-7001',
        primary_email: 'lisa@harborshipping.com',
        city: 'Seattle',
        state: 'WA',
        zip_code: '98101',
        territory_id: washingtonId,
        organization_id: harborOrgId,
        callback_date: tomorrow.toISOString().split('T')[0],
        callback_time: '14:00:00',
      },
      {
        name: 'TLEAD-00008',
        company_name: 'Continental Freight',
        industry: 'Freight Forwarding',
        status: 'Proposal',
        lead_owner_id: johnId,
        assigned_to_id: johnId,
        primary_contact_name: 'David Lee',
        primary_title: 'Business Development',
        primary_phone: '555-8001',
        primary_email: 'david@continentalfreight.com',
        city: 'Chicago',
        state: 'IL',
        zip_code: '60601',
        territory_id: illinoisId,
        organization_id: continentalOrgId,
        callback_date: nextWeek.toISOString().split('T')[0],
        callback_time: '10:00:00',
      },
      // More prospects with different statuses
      {
        name: 'TLEAD-00009',
        company_name: 'West Coast Transport',
        industry: 'Transportation',
        status: 'Interested',
        lead_owner_id: janeId,
        assigned_to_id: janeId,
        primary_contact_name: 'Jennifer White',
        primary_title: 'Operations Manager',
        primary_phone: '555-9001',
        primary_email: 'jennifer@westcoast.com',
        city: 'San Francisco',
        state: 'CA',
        zip_code: '94101',
        territory_id: californiaId,
        organization_id: westCoastOrgId,
        callback_date: null,
      },
      {
        name: 'TLEAD-00010',
        company_name: 'Mountain Freight',
        industry: 'Freight',
        status: 'Proposal',
        lead_owner_id: shrutiId,
        assigned_to_id: shrutiId,
        primary_contact_name: 'Thomas Anderson',
        primary_title: 'CEO',
        primary_phone: '555-1001',
        primary_email: 'thomas@mountainfreight.com',
        city: 'Denver',
        state: 'CO',
        zip_code: '80201',
        territory_id: coloradoId,
        organization_id: mountainFreightOrgId,
        callback_date: null,
      },
      {
        name: 'TLEAD-00011',
        company_name: 'Coastal Logistics',
        industry: 'Logistics',
        status: 'Won',
        lead_owner_id: calvinId,
        assigned_to_id: calvinId,
        primary_contact_name: 'Maria Garcia',
        primary_title: 'CFO',
        primary_phone: '555-1101',
        primary_email: 'maria@coastallogistics.com',
        city: 'Miami',
        state: 'FL',
        zip_code: '33101',
        territory_id: floridaId,
        organization_id: coastalLogisticsOrgId,
        callback_date: null,
      },
      {
        name: 'TLEAD-00012',
        company_name: 'Fast Track Delivery',
        industry: 'Delivery',
        status: 'Lost',
        lead_owner_id: janeId,
        assigned_to_id: janeId,
        primary_contact_name: 'Robert Taylor',
        primary_title: 'Operations Director',
        primary_phone: '555-1201',
        primary_email: 'robert@fasttrack.com',
        city: 'Phoenix',
        state: 'AZ',
        zip_code: '85001',
        territory_id: arizonaId,
        organization_id: fastTrackOrgId,
        callback_date: null,
      },
    ];

    for (const lead of leadsData) {
      await pool.query(`
        INSERT INTO tallac_leads (
          name, company_name, industry, status, lead_owner_id, assigned_to_id,
          primary_contact_name, primary_title, primary_phone, primary_email,
          city, state, zip_code, territory_id, organization_id, callback_date, callback_time
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
        ON CONFLICT (name) DO UPDATE SET
          company_name = EXCLUDED.company_name,
          status = EXCLUDED.status,
          callback_date = EXCLUDED.callback_date,
          callback_time = EXCLUDED.callback_time
      `, [
        lead.name,
        lead.company_name,
        lead.industry,
        lead.status,
        lead.lead_owner_id,
        lead.assigned_to_id,
        lead.primary_contact_name,
        lead.primary_title,
        lead.primary_phone,
        lead.primary_email,
        lead.city,
        lead.state,
        lead.zip_code,
        lead.territory_id,
        lead.organization_id,
        lead.callback_date || null,
        lead.callback_time || null,
      ]);
    }
    console.log(`✅ Inserted/Updated ${leadsData.length} leads`);

    // Insert contact paths for leads
    const leadIds = await pool.query("SELECT id, name FROM tallac_leads ORDER BY name");
    for (let i = 0; i < Math.min(6, leadIds.rows.length); i++) {
      const leadId = leadIds.rows[i].id;
      await pool.query(`
        INSERT INTO tallac_lead_contact_paths (lead_id, contact_name, status, sequence)
        VALUES 
          ($1, 'Head Office', 'Not Contacted', 1),
          ($1, 'John Smith', 'Contacted', 2),
          ($1, 'Mary Johnson', 'Interested', 3)
        ON CONFLICT DO NOTHING
      `, [leadId]);
    }
    console.log('✅ Inserted contact paths');

    // Get activity status IDs
    const openStatus = await pool.query("SELECT id FROM activity_statuses WHERE status_name = 'Open'");
    const completedStatus = await pool.query("SELECT id FROM activity_statuses WHERE status_name = 'Completed'");
    const openStatusId = openStatus.rows[0]?.id;
    const completedStatusId = completedStatus.rows[0]?.id;

    // Get lead and organization mappings for activities
    const getLeadByName = async (name: string) => {
      const result = await pool.query("SELECT id, company_name, organization_id FROM tallac_leads WHERE name = $1", [name]);
      return result.rows[0];
    };

    // Insert comprehensive activities with all activity types
    const activitiesData = [
      // Call Log activities
      {
        name: 'TACT-00001',
        activity_type: 'call-log',
        title: 'Follow-up Call Required',
        subject: 'Follow-up Call Required',
        status_id: openStatusId,
        priority: 'High',
        scheduled_date: today.toISOString().split('T')[0],
        scheduled_time: '14:00:00',
        assigned_to_id: shrutiId,
        created_by_id: calvinId,
        description: 'Need to follow up on the proposal discussed last week. Client showed interest in expanding their fleet.',
        reference_docname: 'TLEAD-00001',
        company: 'Northern Logistics',
      },
      {
        name: 'TACT-00002',
        activity_type: 'call-log',
        title: 'Call Log - Initial Contact',
        subject: 'Initial Call',
        status_id: completedStatusId,
        priority: 'Medium',
        scheduled_date: today.toISOString().split('T')[0],
        scheduled_time: '10:00:00',
        assigned_to_id: calvinId,
        created_by_id: calvinId,
        description: 'Made initial contact with procurement manager. Very receptive to our services.',
        reference_docname: 'TLEAD-00007',
        company: 'Harbor Shipping',
      },
      // Callback activities
      {
        name: 'TACT-00003',
        activity_type: 'callback',
        title: 'Schedule Callback Requested',
        subject: 'Callback Request',
        status_id: openStatusId,
        priority: 'High',
        scheduled_date: tomorrow.toISOString().split('T')[0],
        scheduled_time: '14:00:00',
        assigned_to_id: calvinId,
        created_by_id: calvinId,
        description: 'Client requested callback to discuss Q4 logistics partnership. Preferred time: 2-4 PM.',
        reference_docname: 'TLEAD-00003',
        company: 'Pacific Transport',
      },
      {
        name: 'TACT-00004',
        activity_type: 'callback',
        title: 'Client Requested Callback',
        subject: 'Callback Scheduled',
        status_id: openStatusId,
        priority: 'Medium',
        scheduled_date: nextWeek.toISOString().split('T')[0],
        scheduled_time: '15:00:00',
        assigned_to_id: shrutiId,
        created_by_id: shrutiId,
        description: 'Client requested callback to discuss quarterly review and performance metrics.',
        reference_docname: 'TLEAD-00001',
        company: 'Northern Logistics',
      },
      // Appointment activities
      {
        name: 'TACT-00005',
        activity_type: 'appointment',
        title: 'Client Appointment Scheduled',
        subject: 'Client Meeting',
        status_id: openStatusId,
        priority: 'High',
        scheduled_date: tomorrow.toISOString().split('T')[0],
        scheduled_time: '10:00:00',
        assigned_to_id: shrutiId,
        created_by_id: shrutiId,
        description: 'Scheduled appointment with CEO to discuss partnership opportunities.',
        reference_docname: 'TLEAD-00005',
        company: 'Eagle Freight',
      },
      {
        name: 'TACT-00006',
        activity_type: 'appointment',
        title: 'Product Demo Meeting',
        subject: 'Product Demo',
        status_id: openStatusId,
        priority: 'Medium',
        scheduled_date: nextWeek.toISOString().split('T')[0],
        scheduled_time: '11:00:00',
        assigned_to_id: johnId,
        created_by_id: johnId,
        description: 'Product demonstration meeting scheduled.',
        reference_docname: 'TLEAD-00008',
        company: 'Continental Freight',
      },
      // Note activities
      {
        name: 'TACT-00007',
        activity_type: 'note',
        title: 'Meeting Notes - Strategy Discussion',
        subject: 'Strategy Meeting Notes',
        status_id: openStatusId,
        priority: 'Low',
        scheduled_date: today.toISOString().split('T')[0],
        scheduled_time: '09:00:00',
        assigned_to_id: johnId,
        created_by_id: johnId,
        description: 'Detailed notes from the strategy meeting covering expansion plans and budget allocation.',
        reference_docname: 'TLEAD-00004',
        company: 'Coastal Carriers',
      },
      {
        name: 'TACT-00008',
        activity_type: 'note',
        title: 'Client Feedback Notes',
        subject: 'Feedback Session',
        status_id: openStatusId,
        priority: 'Low',
        scheduled_date: today.toISOString().split('T')[0],
        scheduled_time: '16:00:00',
        assigned_to_id: calvinId,
        created_by_id: calvinId,
        description: 'Captured client feedback from the implementation review meeting.',
        reference_docname: 'TLEAD-00002',
        company: 'Summit Logistics',
      },
      // Changes activities
      {
        name: 'TACT-00009',
        activity_type: 'changes',
        title: 'Status Update - Contract Review',
        subject: 'Contract Status',
        status_id: completedStatusId,
        priority: 'Medium',
        scheduled_date: yesterday.toISOString().split('T')[0],
        scheduled_time: '13:00:00',
        assigned_to_id: shrutiId,
        created_by_id: shrutiId,
        description: 'Updated the contract status after legal review. Waiting for client signature.',
        reference_docname: 'TLEAD-00002',
        company: 'Summit Logistics',
      },
      {
        name: 'TACT-00010',
        activity_type: 'changes',
        title: 'Contract Status Update',
        subject: 'Contract Progress',
        status_id: completedStatusId,
        priority: 'Medium',
        scheduled_date: nextWeek.toISOString().split('T')[0],
        scheduled_time: '10:00:00',
        assigned_to_id: johnId,
        created_by_id: adminId,
        description: 'Contract signed and countersigned. Moving to implementation phase.',
        reference_docname: 'TLEAD-00008',
        company: 'Continental Freight',
      },
      // Assignment activities
      {
        name: 'TACT-00011',
        activity_type: 'assignment',
        title: 'Prospect Assigned to Sales Team',
        subject: 'New Assignment',
        status_id: openStatusId,
        priority: 'High',
        scheduled_date: yesterday.toISOString().split('T')[0],
        scheduled_time: '08:00:00',
        assigned_to_id: calvinId,
        created_by_id: adminId,
        description: 'Assigned new prospect to sales team for follow-up. Priority level: High.',
        reference_docname: 'TLEAD-00006',
        company: 'Mountain Express',
      },
      {
        name: 'TACT-00012',
        activity_type: 'assignment',
        title: 'Lead Reassigned',
        subject: 'Reassignment',
        status_id: openStatusId,
        priority: 'Medium',
        scheduled_date: today.toISOString().split('T')[0],
        scheduled_time: '09:00:00',
        assigned_to_id: shrutiId,
        created_by_id: adminId,
        description: 'Lead reassigned to different sales representative.',
        reference_docname: 'TLEAD-00007',
        company: 'Harbor Shipping',
      },
    ];

    for (const activity of activitiesData) {
      const lead = await getLeadByName(activity.reference_docname);
      const orgId = lead?.organization_id || await getOrgId(activity.company);
      
      await pool.query(`
        INSERT INTO tallac_activities (
          name, activity_type, title, status_id, priority,
          scheduled_date, scheduled_time, assigned_to_id, created_by_id,
          description, reference_doctype, reference_docname, organization_id
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
        ON CONFLICT (name) DO UPDATE SET
          activity_type = EXCLUDED.activity_type,
          title = EXCLUDED.title,
          scheduled_date = EXCLUDED.scheduled_date,
          organization_id = EXCLUDED.organization_id
      `, [
        activity.name,
        activity.activity_type,
        activity.title,
        activity.status_id,
        activity.priority,
        activity.scheduled_date,
        activity.scheduled_time,
        activity.assigned_to_id,
        activity.created_by_id,
        activity.description,
        'Tallac Lead',
        activity.reference_docname,
        orgId,
      ]);
    }
    console.log(`✅ Inserted/Updated ${activitiesData.length} activities`);

    // Insert call logs
    const connectedStatus = await pool.query("SELECT id FROM call_statuses WHERE status_name = 'Connected'");
    const connectedStatusId = connectedStatus.rows[0]?.id;

    const callLogsData = [
      {
        name: 'TCALL-00001',
        call_type: 'Outgoing',
        call_status_id: connectedStatusId,
        call_date: today.toISOString().split('T')[0],
        call_time: '14:30:00',
        call_outcome: 'Positive',
        handled_by_id: calvinId,
        caller_number: '555-1000',
        receiver_number: '555-8001',
        call_duration: 300,
        call_summary: 'Discussed pricing and timeline. Customer interested in moving forward.',
        reference_docname: 'TLEAD-00001',
      },
      {
        name: 'TCALL-00002',
        call_type: 'Incoming',
        call_status_id: connectedStatusId,
        call_date: yesterday.toISOString().split('T')[0],
        call_time: '11:00:00',
        call_outcome: 'Neutral',
        handled_by_id: shrutiId,
        caller_number: '555-8002',
        receiver_number: '555-1001',
        call_duration: 180,
        call_summary: 'Customer requested callback to discuss proposal.',
        reference_docname: 'TLEAD-00002',
      },
      {
        name: 'TCALL-00003',
        call_type: 'Outgoing',
        call_status_id: connectedStatusId,
        call_date: today.toISOString().split('T')[0],
        call_time: '15:00:00',
        call_outcome: 'Positive',
        handled_by_id: calvinId,
        caller_number: '555-1000',
        receiver_number: '555-7001',
        call_duration: 450,
        call_summary: 'Initial contact call. Very positive response.',
        reference_docname: 'TLEAD-00007',
      },
    ];

    for (const callLog of callLogsData) {
      await pool.query(`
        INSERT INTO tallac_call_logs (
          name, call_type, call_status_id, call_date, call_time,
          call_outcome, handled_by_id, caller_number, receiver_number,
          call_duration, call_summary, reference_doctype, reference_docname
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
        ON CONFLICT (name) DO NOTHING
      `, [
        callLog.name,
        callLog.call_type,
        callLog.call_status_id,
        callLog.call_date,
        callLog.call_time,
        callLog.call_outcome,
        callLog.handled_by_id,
        callLog.caller_number,
        callLog.receiver_number,
        callLog.call_duration,
        callLog.call_summary,
        'Tallac Lead',
        callLog.reference_docname,
      ]);
    }
    console.log(`✅ Inserted ${callLogsData.length} call logs`);

    // Insert notes
    const notesData = [
      {
        title: 'Initial Research',
        content: 'Initial research completed on company requirements and pain points.',
        reference_docname: 'TLEAD-00001',
        created_by_id: adminId,
      },
      {
        title: 'Meeting Notes',
        content: 'Meeting scheduled for next week to review proposal details.',
        reference_docname: 'TLEAD-00002',
        created_by_id: calvinId,
      },
      {
        title: 'Follow-up Required',
        content: 'Client needs follow-up call to discuss pricing options.',
        reference_docname: 'TLEAD-00003',
        created_by_id: shrutiId,
      },
    ];

    for (const note of notesData) {
      await pool.query(`
        INSERT INTO tallac_notes (title, content, reference_doctype, reference_docname, created_by_id)
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT DO NOTHING
      `, [
        note.title,
        note.content,
        'Tallac Lead',
        note.reference_docname,
        note.created_by_id,
      ]);
    }
    console.log(`✅ Inserted ${notesData.length} notes`);

    console.log('✅ Database seeding completed successfully!');
    console.log(`📊 Summary:
      - ${leadsData.length} Prospects (with queue statuses: overdue, today, scheduled)
      - ${activitiesData.length} Activities (all types: call-log, callback, appointment, note, changes, assignment)
      - ${callLogsData.length} Call Logs
      - ${notesData.length} Notes
      - All activities linked to prospects via company name`);
  } catch (error) {
    console.error('❌ Error seeding database:', error);
    throw error;
  }
}

// Run if called directly
if (require.main === module) {
  seedDatabase()
    .then(() => {
      console.log('✅ Seeding complete');
      process.exit(0);
    })
    .catch((error) => {
      console.error('❌ Seeding failed:', error);
      process.exit(1);
    });
}

export default seedDatabase;
