"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const database_1 = require("../config/database");
const bcryptjs_1 = __importDefault(require("bcryptjs"));
async function seedDatabase() {
    try {
        console.log('🧹 Cleaning all existing data...');
        // Delete all data in reverse dependency order
        await database_1.pool.query('DELETE FROM partner_team_members');
        await database_1.pool.query('DELETE FROM partner_territories');
        await database_1.pool.query('DELETE FROM tallac_partners');
        await database_1.pool.query('DELETE FROM territory_zip_codes');
        await database_1.pool.query('DELETE FROM territory_owners');
        await database_1.pool.query('DELETE FROM user_territory_assignments');
        await database_1.pool.query('DELETE FROM user_telephony_assignments');
        await database_1.pool.query('DELETE FROM knowledge_base_files'); // Delete before users
        await database_1.pool.query('DELETE FROM tallac_lead_contact_paths');
        await database_1.pool.query('DELETE FROM tallac_call_logs');
        await database_1.pool.query('DELETE FROM tallac_notes');
        await database_1.pool.query('DELETE FROM tallac_activities');
        await database_1.pool.query('DELETE FROM tallac_leads');
        await database_1.pool.query('DELETE FROM tallac_contacts');
        await database_1.pool.query('DELETE FROM tallac_organizations');
        // Note: companies table is kept as it may be used elsewhere, but we'll ensure it doesn't block territory deletion
        // First, set territory_id to NULL in companies to avoid foreign key constraint
        await database_1.pool.query('UPDATE companies SET territory_id = NULL WHERE territory_id IS NOT NULL');
        // Handle any foreign key constraints from territories to users
        // Check if there's a user_id or created_by_id column in territories
        await database_1.pool.query(`
      DO $$ 
      BEGIN
        IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='tallac_territories' AND column_name='created_by_id') THEN
          UPDATE tallac_territories SET created_by_id = NULL WHERE created_by_id IS NOT NULL;
        END IF;
        IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='tallac_territories' AND column_name='territory_manager_id') THEN
          UPDATE tallac_territories SET territory_manager_id = NULL WHERE territory_manager_id IS NOT NULL;
        END IF;
        -- Handle territories table (if it exists separately)
        IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='territories') THEN
          IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='territories' AND column_name='created_by_id') THEN
            UPDATE territories SET created_by_id = NULL WHERE created_by_id IS NOT NULL;
          END IF;
          IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='territories' AND column_name='user_id') THEN
            UPDATE territories SET user_id = NULL WHERE user_id IS NOT NULL;
          END IF;
        END IF;
      END $$;
    `);
        await database_1.pool.query('DELETE FROM tallac_territories');
        // Delete territories table if it exists - use TRUNCATE CASCADE to handle foreign keys
        try {
            await database_1.pool.query('TRUNCATE TABLE territories CASCADE');
        }
        catch (e) {
            // If TRUNCATE fails, try to delete after nullifying references
            try {
                await database_1.pool.query(`
          DO $$ 
          DECLARE
            col_name text;
          BEGIN
            -- Find the column that references users
            SELECT column_name INTO col_name
            FROM information_schema.table_constraints tc
            JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name
            WHERE tc.table_name = 'territories' 
              AND tc.constraint_type = 'FOREIGN KEY'
              AND tc.constraint_name = 'FK_c006aad36786c43371d7375a4de';
            
            IF col_name IS NOT NULL THEN
              EXECUTE format('UPDATE territories SET %I = NULL', col_name);
            END IF;
            
            DELETE FROM territories;
          EXCEPTION WHEN OTHERS THEN
            -- Ignore errors
            NULL;
          END $$;
        `);
            }
            catch (e2) {
                // Ignore
            }
        }
        await database_1.pool.query('DELETE FROM telephony_lines');
        await database_1.pool.query('DELETE FROM users');
        console.log('✅ All data cleaned');
        // Hash password for all users
        const passwordHash = await bcryptjs_1.default.hash('123@tallac', 10);
        // Insert activity statuses
        await database_1.pool.query(`
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
        await database_1.pool.query(`
      INSERT INTO call_statuses (status_name, description)
      VALUES 
        ('Connected', 'Call was connected'),
        ('No Answer', 'Call was not answered'),
        ('Busy', 'Line was busy'),
        ('Failed', 'Call failed')
      ON CONFLICT (status_name) DO NOTHING
    `);
        console.log('✅ Call statuses ready');
        // Insert users - one for each role
        const usersData = [
            { email: 'corporate.admin@tallac.io', firstName: 'Corporate', lastName: 'Admin', role: 'Corporate Admin', tallacRole: 'Corporate Admin' },
            { email: 'business.coach@tallac.io', firstName: 'Business', lastName: 'Coach', role: 'Business Coach', tallacRole: 'Business Coach' },
            { email: 'territory.admin@tallac.io', firstName: 'Territory', lastName: 'Admin', role: 'Territory Admin', tallacRole: 'Territory Admin' },
            { email: 'territory.manager@tallac.io', firstName: 'Territory', lastName: 'Manager', role: 'Territory Manager', tallacRole: 'Territory Manager' },
            { email: 'sales.user@tallac.io', firstName: 'Sales', lastName: 'User', role: 'Sales User', tallacRole: 'Sales User' },
            { email: 'john.doe@tallac.io', firstName: 'John', lastName: 'Doe', role: 'Sales User', tallacRole: 'Sales User' },
            { email: 'jane.smith@tallac.io', firstName: 'Jane', lastName: 'Smith', role: 'Territory Manager', tallacRole: 'Territory Manager' },
            { email: 'mike.johnson@tallac.io', firstName: 'Mike', lastName: 'Johnson', role: 'Territory Admin', tallacRole: 'Territory Admin' },
            { email: 'sarah.williams@tallac.io', firstName: 'Sarah', lastName: 'Williams', role: 'Business Coach', tallacRole: 'Business Coach' },
            { email: 'david.brown@tallac.io', firstName: 'David', lastName: 'Brown', role: 'Sales User', tallacRole: 'Sales User' }
        ];
        for (const user of usersData) {
            await database_1.pool.query(`
        INSERT INTO users (email, first_name, last_name, full_name, password_hash, role, is_active, tallac_role, mobile_no, "firstName", "lastName", active)
        VALUES ($1, $2, $3, $4, $5, $6, true, $7, $8, $2, $3, true)
        ON CONFLICT (email) DO UPDATE SET
          first_name = EXCLUDED.first_name,
          last_name = EXCLUDED.last_name,
          full_name = EXCLUDED.full_name,
          password_hash = EXCLUDED.password_hash,
          role = EXCLUDED.role,
          tallac_role = EXCLUDED.tallac_role,
          mobile_no = EXCLUDED.mobile_no,
          "firstName" = EXCLUDED."firstName",
          "lastName" = EXCLUDED."lastName",
          active = true
      `, [
                user.email,
                user.firstName,
                user.lastName,
                `${user.firstName} ${user.lastName}`,
                passwordHash,
                user.role,
                user.tallacRole,
                `555-${Math.floor(Math.random() * 9000) + 1000}`
            ]);
        }
        console.log(`✅ Inserted ${usersData.length} users`);
        // Get user IDs
        const getUser = async (email) => {
            const result = await database_1.pool.query('SELECT id FROM users WHERE email = $1', [email]);
            return result.rows[0]?.id;
        };
        const corporateAdminId = await getUser('corporate.admin@tallac.io');
        const businessCoachId = await getUser('business.coach@tallac.io');
        const territoryAdminId = await getUser('territory.admin@tallac.io');
        const territoryManagerId = await getUser('territory.manager@tallac.io');
        const salesUserId = await getUser('sales.user@tallac.io');
        const johnId = await getUser('john.doe@tallac.io');
        const janeId = await getUser('jane.smith@tallac.io');
        const mikeId = await getUser('mike.johnson@tallac.io');
        const sarahId = await getUser('sarah.williams@tallac.io');
        const davidId = await getUser('david.brown@tallac.io');
        // Insert 8 territories with proper data matching Vue3 structure
        const territoriesData = [
            { name: 'Addison', code: '525TX', dba: 'Fastest Labs of Addison', region: 'South Central', state: 'Texas', status: 'Active' },
            { name: 'Ann Arbor', code: '453MI', dba: 'Fastest Labs of Ann Arbor', region: 'Midwest', state: 'Michigan', status: 'Active' },
            { name: 'Beaumont', code: '569TX', dba: 'Fastest Labs of Beaumont', region: 'South Central', state: 'Texas', status: 'Active' },
            { name: 'Bethlehem', code: '510PA', dba: 'Fastest Labs of Bethlehem', region: 'Northeast', state: 'Pennsylvania', status: 'Active' },
            { name: 'Alexandria', code: '224VA', dba: 'Fastest Labs of Alexandria', region: 'Southeast', state: 'Virginia', status: 'Active' },
            { name: 'Asheville', code: '281NC', dba: 'Fastest Labs of Asheville', region: 'Southeast', state: 'North Carolina', status: 'Active' },
            { name: 'Bellingham', code: '529WA', dba: 'Fastest Labs of Bellingham', region: 'Pacific Northwest', state: 'Washington', status: 'Active' },
            { name: 'Bloomington', code: '150MN', dba: 'Fastest Labs of Bloomington', region: 'Midwest', state: 'Minnesota', status: 'Active' },
            { name: 'Anaheim', code: '216CA', dba: 'Fastest Labs of Anaheim', region: 'Pacific Southwest', state: 'California', status: 'Active' },
            { name: 'Azusa', code: '547CA', dba: 'Fastest Labs of Azusa', region: 'Pacific Southwest', state: 'California', status: 'Active' }
        ];
        const territoryIds = {};
        for (const territory of territoriesData) {
            const result = await database_1.pool.query(`
        INSERT INTO tallac_territories (territory_name, territory_code, territory_dba, doing_business_as, territory_region, territory_state, territory_status, status)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      ON CONFLICT DO NOTHING
        RETURNING id, territory_name
      `, [territory.name, territory.code, territory.dba, territory.dba, territory.region, territory.state, territory.status, territory.status]);
            if (result.rows.length > 0) {
                territoryIds[territory.name] = result.rows[0].id;
            }
            else {
                // Get existing territory ID
                const existing = await database_1.pool.query('SELECT id FROM tallac_territories WHERE territory_name = $1', [territory.name]);
                if (existing.rows.length > 0) {
                    territoryIds[territory.name] = existing.rows[0].id;
                    // Update existing territory
                    await database_1.pool.query(`
            UPDATE tallac_territories SET
              territory_code = $1,
              territory_dba = $2,
              doing_business_as = $3,
              territory_region = $4,
              territory_state = $5,
              territory_status = $6,
              status = $7
            WHERE id = $8
          `, [territory.code, territory.dba, territory.dba, territory.region, territory.state, territory.status, territory.status, territoryIds[territory.name]]);
                }
            }
        }
        console.log(`✅ Inserted ${territoriesData.length} territories`);
        // Add zip codes to territories (5-10 zipcodes per territory)
        const zipCodesMap = {
            'Addison': ['75001', '75002', '75003', '75004', '75005', '75006', '75007', '75008', '75009', '75010'],
            'Ann Arbor': ['48103', '48104', '48105', '48106', '48107', '48108', '48109'],
            'Beaumont': ['77701', '77702', '77703', '77704', '77705', '77706', '77707', '77708', '77709', '77710', '77711', '77712', '77713', '77714', '77715', '77716', '77717', '77718', '77719', '77720', '77721', '77722'],
            'Bethlehem': ['18015', '18016', '18017', '18018'],
            'Alexandria': ['22301', '22302', '22303', '22304', '22305', '22306', '22307', '22308', '22309', '22310', '22311', '22312'],
            'Asheville': ['28801', '28802', '28803', '28804', '28805', '28806', '28807', '28808', '28809', '28810', '28811', '28812', '28813', '28814', '28815'],
            'Bellingham': ['98225', '98226', '98227', '98228', '98229'],
            'Bloomington': ['55420', '55421', '55422', '55423', '55424', '55425', '55426', '55427', '55428', '55429', '55430', '55431', '55432', '55433'],
            'Anaheim': ['92801', '92802', '92803', '92804', '92805', '92806', '92807', '92808'],
            'Azusa': ['91702', '91740', '91741', '91745', '91770', '91771', '91772', '91773', '91774', '91775', '91776']
        };
        for (const [territoryName, zipCodes] of Object.entries(zipCodesMap)) {
            const territoryId = territoryIds[territoryName];
            if (territoryId) {
                for (const zipCode of zipCodes) {
                    await database_1.pool.query(`
            INSERT INTO territory_zip_codes (territory_id, zip_code, state)
            VALUES ($1, $2, $3)
            ON CONFLICT (territory_id, zip_code) DO NOTHING
          `, [territoryId, zipCode, territoriesData.find(t => t.name === territoryName)?.state || '']);
                }
            }
        }
        console.log('✅ Inserted zip codes for territories');
        // Insert 8 partners
        const partnersData = [
            { code: 'PART-001', name: 'Northeast Partner', status: 'Active', city: 'Boston', state: 'MA', email: 'contact@northeastpartner.com', mobile: '555-1001', address: '123 Main St, Boston, MA 02101' },
            { code: 'PART-002', name: 'Southeast Partner', status: 'Active', city: 'Atlanta', state: 'GA', email: 'contact@southeastpartner.com', mobile: '555-2001', address: '456 Oak Ave, Atlanta, GA 30301' },
            { code: 'PART-003', name: 'Midwest Partner', status: 'Active', city: 'Chicago', state: 'IL', email: 'contact@midwestpartner.com', mobile: '555-3001', address: '789 Pine St, Chicago, IL 60601' },
            { code: 'PART-004', name: 'Southwest Partner', status: 'Active', city: 'Dallas', state: 'TX', email: 'contact@southwestpartner.com', mobile: '555-4001', address: '321 Elm St, Dallas, TX 75201' },
            { code: 'PART-005', name: 'West Coast Partner', status: 'Active', city: 'Los Angeles', state: 'CA', email: 'contact@westcoastpartner.com', mobile: '555-5001', address: '654 Maple Dr, Los Angeles, CA 90001' },
            { code: 'PART-006', name: 'Pacific Partner', status: 'Active', city: 'Seattle', state: 'WA', email: 'contact@pacificpartner.com', mobile: '555-6001', address: '987 Cedar Ln, Seattle, WA 98101' },
            { code: 'PART-007', name: 'Mountain Partner', status: 'Active', city: 'Denver', state: 'CO', email: 'contact@mountainpartner.com', mobile: '555-7001', address: '147 Birch Way, Denver, CO 80201' },
            { code: 'PART-008', name: 'Central Partner', status: 'Active', city: 'Kansas City', state: 'MO', email: 'contact@centralpartner.com', mobile: '555-8001', address: '258 Spruce St, Kansas City, MO 64101' }
        ];
        const partnerIds = {};
        for (const partner of partnersData) {
            // First try to insert, if conflict on partner_code, update
            let result;
            try {
                result = await database_1.pool.query(`INSERT INTO tallac_partners (name, partner_code, partner_name, partner_status, partner_city, partner_state, partner_email, partner_mobile, partner_address)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
           RETURNING id, name`, [partner.code, partner.code, partner.name, partner.status, partner.city, partner.state, partner.email, partner.mobile, partner.address]);
            }
            catch (e) {
                // If conflict, update existing
                if (e.code === '23505') { // Unique violation
                    await database_1.pool.query(`
            UPDATE tallac_partners SET
              partner_name = $1,
              partner_status = $2,
              partner_city = $3,
              partner_state = $4,
              partner_email = $5,
              partner_mobile = $6,
              partner_address = $7
            WHERE partner_code = $8
          `, [partner.name, partner.status, partner.city, partner.state, partner.email, partner.mobile, partner.address, partner.code]);
                    result = await database_1.pool.query('SELECT id, name FROM tallac_partners WHERE partner_code = $1', [partner.code]);
                }
                else {
                    throw e;
                }
            }
            if (result.rows.length > 0) {
                partnerIds[partner.code] = result.rows[0].id;
            }
            else {
                const existing = await database_1.pool.query('SELECT id, name FROM tallac_partners WHERE partner_code = $1', [partner.code]);
                if (existing.rows.length > 0) {
                    partnerIds[partner.code] = existing.rows[0].id;
                }
            }
        }
        console.log(`✅ Inserted ${partnersData.length} partners`);
        // Link partners to territories (primary partner for each territory)
        const partnerTerritoryMap = {
            'Addison': 'PART-004',
            'Ann Arbor': 'PART-003',
            'Beaumont': 'PART-004',
            'Bethlehem': 'PART-001',
            'Alexandria': 'PART-002',
            'Asheville': 'PART-002',
            'Bellingham': 'PART-006',
            'Bloomington': 'PART-003',
            'Anaheim': 'PART-005',
            'Azusa': 'PART-005'
        };
        for (const [territoryName, partnerCode] of Object.entries(partnerTerritoryMap)) {
            const territoryId = territoryIds[territoryName];
            const partnerId = partnerIds[partnerCode];
            if (territoryId && partnerId) {
                await database_1.pool.query(`
          INSERT INTO partner_territories (partner_id, territory_id, is_primary)
          VALUES ($1, $2, true)
          ON CONFLICT (partner_id, territory_id) DO UPDATE SET is_primary = true
        `, [partnerId, territoryId]);
            }
        }
        console.log('✅ Linked partners to territories');
        // Insert 10 prospects
        const prospectsData = [
            { name: 'TLEAD-00001', company: 'Northern Logistics', industry: 'Logistics', status: 'New', territory: 'Addison', owner: johnId, assigned: johnId, contact: 'John Smith', title: 'CEO', phone: '555-1001', email: 'john@northernlogistics.com', city: 'Addison', state: 'TX', zip: '75001' },
            { name: 'TLEAD-00002', company: 'Summit Logistics', industry: 'Transportation', status: 'Contacted', territory: 'Ann Arbor', owner: janeId, assigned: janeId, contact: 'Jane Doe', title: 'Operations Director', phone: '555-2001', email: 'jane@summitlogistics.com', city: 'Ann Arbor', state: 'MI', zip: '48103' },
            { name: 'TLEAD-00003', company: 'Pacific Transport', industry: 'Shipping', status: 'Interested', territory: 'Beaumont', owner: mikeId, assigned: mikeId, contact: 'Mike Johnson', title: 'VP Sales', phone: '555-3001', email: 'mike@pacifictransport.com', city: 'Beaumont', state: 'TX', zip: '77701' },
            { name: 'TLEAD-00004', company: 'Coastal Carriers', industry: 'Freight', status: 'Proposal', territory: 'Bethlehem', owner: sarahId, assigned: sarahId, contact: 'Sarah Williams', title: 'CFO', phone: '555-4001', email: 'sarah@coastalcarriers.com', city: 'Bethlehem', state: 'PA', zip: '18015' },
            { name: 'TLEAD-00005', company: 'Eagle Freight', industry: 'Logistics', status: 'Won', territory: 'Alexandria', owner: davidId, assigned: davidId, contact: 'David Brown', title: 'Director', phone: '555-5001', email: 'david@eaglefreight.com', city: 'Alexandria', state: 'VA', zip: '22301' },
            { name: 'TLEAD-00006', company: 'Mountain Express', industry: 'Express', status: 'New', territory: 'Asheville', owner: salesUserId, assigned: salesUserId, contact: 'Robert Taylor', title: 'Manager', phone: '555-6001', email: 'robert@mountainexpress.com', city: 'Asheville', state: 'NC', zip: '28801' },
            { name: 'TLEAD-00007', company: 'Harbor Shipping', industry: 'Maritime', status: 'Contacted', territory: 'Bellingham', owner: territoryManagerId, assigned: territoryManagerId, contact: 'Lisa Martinez', title: 'Operations Manager', phone: '555-7001', email: 'lisa@harborshipping.com', city: 'Bellingham', state: 'WA', zip: '98225' },
            { name: 'TLEAD-00008', company: 'Continental Freight', industry: 'Freight Forwarding', status: 'Interested', territory: 'Bloomington', owner: territoryAdminId, assigned: territoryAdminId, contact: 'Thomas Anderson', title: 'VP Operations', phone: '555-8001', email: 'thomas@continentalfreight.com', city: 'Bloomington', state: 'MN', zip: '55420' },
            { name: 'TLEAD-00009', company: 'West Coast Transport', industry: 'Transportation', status: 'Proposal', territory: 'Anaheim', owner: businessCoachId, assigned: businessCoachId, contact: 'Jennifer White', title: 'CEO', phone: '555-9001', email: 'jennifer@westcoast.com', city: 'Anaheim', state: 'CA', zip: '92801' },
            { name: 'TLEAD-00010', company: 'Fast Track Delivery', industry: 'Delivery', status: 'Lost', territory: 'Azusa', owner: corporateAdminId, assigned: corporateAdminId, contact: 'Michael Chen', title: 'Director', phone: '555-0010', email: 'michael@fasttrack.com', city: 'Azusa', state: 'CA', zip: '91702' }
        ];
        for (const prospect of prospectsData) {
            const territoryId = territoryIds[prospect.territory];
            await database_1.pool.query(`
        INSERT INTO tallac_leads (
          name, company_name, industry, status, lead_owner_id, assigned_to_id,
          primary_contact_name, primary_title, primary_phone, primary_email,
          city, state, zip_code, territory_id
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
        ON CONFLICT (name) DO UPDATE SET
          company_name = EXCLUDED.company_name,
          status = EXCLUDED.status,
          assigned_to_id = EXCLUDED.assigned_to_id
      `, [
                prospect.name,
                prospect.company,
                prospect.industry,
                prospect.status,
                prospect.owner,
                prospect.assigned,
                prospect.contact,
                prospect.title,
                prospect.phone,
                prospect.email,
                prospect.city,
                prospect.state,
                prospect.zip,
                territoryId
            ]);
        }
        console.log(`✅ Inserted ${prospectsData.length} prospects`);
        // Insert 10 activities
        const openStatus = await database_1.pool.query("SELECT id FROM activity_statuses WHERE status_name = 'Open'");
        const completedStatus = await database_1.pool.query("SELECT id FROM activity_statuses WHERE status_name = 'Completed'");
        const openStatusId = openStatus.rows[0]?.id;
        const completedStatusId = completedStatus.rows[0]?.id;
        const today = new Date();
        const tomorrow = new Date(today);
        tomorrow.setDate(tomorrow.getDate() + 1);
        const activitiesData = [
            { name: 'TACT-00001', type: 'call-log', title: 'Follow-up Call', status: openStatusId, priority: 'High', date: today.toISOString().split('T')[0], time: '14:00:00', assigned: johnId, created: johnId, description: 'Need to follow up on proposal', reference: 'TLEAD-00001', company: 'Northern Logistics' },
            { name: 'TACT-00002', type: 'callback', title: 'Callback Scheduled', status: openStatusId, priority: 'Medium', date: tomorrow.toISOString().split('T')[0], time: '10:00:00', assigned: janeId, created: janeId, description: 'Client requested callback', reference: 'TLEAD-00002', company: 'Summit Logistics' },
            { name: 'TACT-00003', type: 'appointment', title: 'Meeting Scheduled', status: openStatusId, priority: 'High', date: tomorrow.toISOString().split('T')[0], time: '15:00:00', assigned: mikeId, created: mikeId, description: 'Product demonstration meeting', reference: 'TLEAD-00003', company: 'Pacific Transport' },
            { name: 'TACT-00004', type: 'note', title: 'Important Note', status: completedStatusId, priority: 'Low', date: today.toISOString().split('T')[0], time: '09:00:00', assigned: sarahId, created: sarahId, description: 'Client showed interest in premium package', reference: 'TLEAD-00004', company: 'Coastal Carriers' },
            { name: 'TACT-00005', type: 'call-log', title: 'Initial Contact Call', status: completedStatusId, priority: 'Medium', date: today.toISOString().split('T')[0], time: '11:00:00', assigned: davidId, created: davidId, description: 'Made initial contact, very receptive', reference: 'TLEAD-00005', company: 'Eagle Freight' },
            { name: 'TACT-00006', type: 'callback', title: 'Follow-up Callback', status: openStatusId, priority: 'High', date: tomorrow.toISOString().split('T')[0], time: '16:00:00', assigned: salesUserId, created: salesUserId, description: 'Need to discuss pricing', reference: 'TLEAD-00006', company: 'Mountain Express' },
            { name: 'TACT-00007', type: 'appointment', title: 'Site Visit', status: openStatusId, priority: 'High', date: tomorrow.toISOString().split('T')[0], time: '13:00:00', assigned: territoryManagerId, created: territoryManagerId, description: 'On-site evaluation scheduled', reference: 'TLEAD-00007', company: 'Harbor Shipping' },
            { name: 'TACT-00008', type: 'note', title: 'Status Update', status: completedStatusId, priority: 'Low', date: today.toISOString().split('T')[0], time: '10:30:00', assigned: territoryAdminId, created: territoryAdminId, description: 'Client reviewing proposal', reference: 'TLEAD-00008', company: 'Continental Freight' },
            { name: 'TACT-00009', type: 'call-log', title: 'Proposal Discussion', status: openStatusId, priority: 'High', date: today.toISOString().split('T')[0], time: '15:30:00', assigned: businessCoachId, created: businessCoachId, description: 'Discussing proposal details', reference: 'TLEAD-00009', company: 'West Coast Transport' },
            { name: 'TACT-00010', type: 'callback', title: 'Final Follow-up', status: openStatusId, priority: 'Medium', date: tomorrow.toISOString().split('T')[0], time: '14:30:00', assigned: corporateAdminId, created: corporateAdminId, description: 'Final follow-up call', reference: 'TLEAD-00010', company: 'Fast Track Delivery' }
        ];
        for (const activity of activitiesData) {
            // Get organization_id from prospect's company_name
            const prospectResult = await database_1.pool.query('SELECT organization_id FROM tallac_leads WHERE name = $1', [activity.reference]);
            const organizationId = prospectResult.rows[0]?.organization_id || null;
            await database_1.pool.query(`
        INSERT INTO tallac_activities (
          name, activity_type, title, status_id, priority,
          scheduled_date, scheduled_time, assigned_to_id, created_by_id,
          description, reference_doctype, reference_docname, organization_id
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
        ON CONFLICT (name) DO UPDATE SET
          title = EXCLUDED.title,
          status_id = EXCLUDED.status_id,
          scheduled_date = EXCLUDED.scheduled_date
      `, [
                activity.name,
                activity.type,
                activity.title,
                activity.status,
                activity.priority,
                activity.date,
                activity.time,
                activity.assigned,
                activity.created,
                activity.description,
                'Tallac Lead',
                activity.reference,
                organizationId
            ]);
        }
        console.log(`✅ Inserted ${activitiesData.length} activities`);
        console.log('\n📊 Summary:');
        console.log(`   - ${usersData.length} Users (one for each role)`);
        console.log(`   - ${territoriesData.length} Territories`);
        console.log(`   - ${partnersData.length} Partners`);
        console.log(`   - ${prospectsData.length} Prospects`);
        console.log(`   - ${activitiesData.length} Activities`);
        console.log('✅ Seeding complete');
    }
    catch (error) {
        console.error('❌ Error seeding database:', error);
        throw error;
    }
}
seedDatabase()
    .then(() => {
    console.log('✅ Database seeding completed successfully');
    process.exit(0);
})
    .catch((error) => {
    console.error('❌ Database seeding failed:', error);
    process.exit(1);
});
//# sourceMappingURL=seed.js.map