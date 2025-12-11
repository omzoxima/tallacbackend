import express from 'express';
import pool from '../config/database.js';
import { authenticateToken } from '../middleware/auth.js';

const router = express.Router();

// Get all prospects with filters
router.get('/', authenticateToken, async (req, res) => {
  try {
    const { status, territory_id, assigned_to, search, limit = 1000, page = 1 } = req.query;
    const userId = req.user.id;
    const userRole = req.user.tallac_role;

    // Build query with territory-based filtering
    let query = `
      SELECT 
        tp.id,
        tp.prospect_code,
        tp.status,
        tp.sub_status,
        tp.source,
        tp.assigned_date,
        tp.last_activity_summary,
        tp.last_call_date,
        tp.last_call_outcome,
        tp.callback_date,
        tp.callback_time,
        tp.next_action,
        tp.created_at,
        tp.updated_at,
        to_org.id as organization_id,
        to_org.organization_name,
        to_org.city,
        to_org.state,
        to_org.zip_code,
        to_org.industry,
        to_org.industry_id,
        ti.industry_name as industry_name,
        tt.id as territory_id,
        tt.territory_name,
        c.id as contact_id,
        c.full_name as lead_name,
        c.first_name as lead_first_name,
        c.last_name as lead_last_name,
        c.designation as title,
        u.id as assigned_to_id,
        u.full_name as assigned_to_name
      FROM tallac_prospects tp
      JOIN tallac_organizations to_org ON tp.organization_id = to_org.id
      LEFT JOIN tallac_industries ti ON to_org.industry_id = ti.id
      LEFT JOIN tallac_territories tt ON to_org.territory_id = tt.id
      LEFT JOIN contacts c ON tp.primary_contact_id = c.id
      LEFT JOIN users u ON tp.assigned_to_id = u.id
      WHERE 1=1
    `;

    const params = [];
    let paramCount = 1;

    // Territory-based access control (unless admin)
    if (!['Corporate Admin', 'System Manager', 'Administrator'].includes(userRole)) {
      // Get user's assigned territories
      const territoriesResult = await pool.query(
        `SELECT territory_id FROM assigned_territories 
         WHERE tallac_user_id = (SELECT id FROM tallac_users WHERE user_id = $1)`,
        [userId]
      );

      const userTerritories = territoriesResult.rows.map(t => t.territory_id);

      if (userTerritories.length > 0) {
        query += ` AND to_org.territory_id = ANY($${paramCount})`;
        params.push(userTerritories);
        paramCount++;
      } else {
        // No territories assigned, show only prospects assigned to user
        query += ` AND tp.assigned_to_id = $${paramCount}`;
        params.push(userId);
        paramCount++;
      }
    }

    // Apply filters
    if (status) {
      query += ` AND tp.status = $${paramCount}`;
      params.push(status);
      paramCount++;
    }

    if (territory_id) {
      query += ` AND to_org.territory_id = $${paramCount}`;
      params.push(territory_id);
      paramCount++;
    }

    if (assigned_to) {
      query += ` AND tp.assigned_to_id = $${paramCount}`;
      params.push(assigned_to);
      paramCount++;
    }

    if (search) {
      query += ` AND (
        to_org.organization_name ILIKE $${paramCount} OR
        c.full_name ILIKE $${paramCount} OR
        c.first_name ILIKE $${paramCount} OR
        c.last_name ILIKE $${paramCount}
      )`;
      params.push(`%${search}%`);
      paramCount++;
    }

    // Add pagination (but allow large limits for showing all data)
    // If limit is 10000 or more, treat as "All" and don't apply limit
    const limitValue = parseInt(limit) || 1000;
    
    if (limitValue >= 10000) {
      // Show all data - no limit
      query += ` ORDER BY tp.created_at DESC`;
    } else {
      const offsetValue = (Math.max(parseInt(page) || 1, 1) - 1) * limitValue;
      query += ` ORDER BY tp.created_at DESC LIMIT $${paramCount} OFFSET $${paramCount + 1}`;
      params.push(limitValue, offsetValue);
    }

    const result = await pool.query(query, params);

    // OPTIMIZED: Batch query all activities for all prospects at once (instead of N+1 queries)
    // Only fetch activities if we have prospects (performance optimization)
    const prospectIds = result.rows.map(p => p.id);
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    let activitiesMap = {};
    if (prospectIds.length > 0) {
      // Use EXISTS subquery for better performance instead of JOIN
      const activitiesResult = await pool.query(
        `SELECT ta.reference_docname as prospect_id, ta.activity_type, ta.scheduled_date 
         FROM tallac_activities ta
         WHERE ta.reference_docname = ANY($1)
           AND ta.reference_doctype = 'Prospect'
           AND ta.assigned_to_id = $2 
           AND EXISTS (
             SELECT 1 FROM activity_statuses ast 
             WHERE ast.id = ta.status_id 
           AND ast.status_name IN ('Open', 'In Progress')
           )
           AND ta.activity_type IN ('Callback', 'Appointment')
           AND ta.scheduled_date IS NOT NULL
         ORDER BY ta.reference_docname, ta.scheduled_date ASC`,
        [prospectIds, userId]
      );

      // Group activities by prospect_id
      for (const activity of activitiesResult.rows) {
        if (!activitiesMap[activity.prospect_id]) {
          activitiesMap[activity.prospect_id] = [];
        }
        activitiesMap[activity.prospect_id].push(activity);
      }
    }

    // Enrich prospects with queue status
    const prospects = result.rows.map((prospect) => {
      const activities = activitiesMap[prospect.id] || [];
      let queue_status = 'none';
      let queue_message = '';

      if (activities.length > 0) {
        const activity = activities[0]; // First scheduled activity
        const scheduledDate = new Date(activity.scheduled_date);
        scheduledDate.setHours(0, 0, 0, 0);

        if (scheduledDate < today) {
          queue_status = 'overdue';
          queue_message = `Overdue: ${activity.activity_type}`;
        } else if (scheduledDate.getTime() === today.getTime()) {
          queue_status = 'today';
          queue_message = `Due Today: ${activity.activity_type}`;
        } else {
          queue_status = 'scheduled';
          queue_message = `Scheduled: ${activity.activity_type}`;
        }
      }

      return {
        ...prospect,
        queue_status,
        queue_message
      };
    });

    res.json({
      success: true,
      data: prospects
    });
  } catch (error) {
    console.error('Get prospects error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch prospects', error: error.message });
  }
});

// Get prospect details
router.get('/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;

    // Get prospect
    const prospectResult = await pool.query(
      `SELECT tp.*, 
        to_org.*, 
        c.*,
        u.full_name as assigned_to_name,
        creator.full_name as owner_name
       FROM tallac_prospects tp
       JOIN tallac_organizations to_org ON tp.organization_id = to_org.id
       LEFT JOIN contacts c ON tp.primary_contact_id = c.id
       LEFT JOIN users u ON tp.assigned_to_id = u.id
       LEFT JOIN users creator ON tp.created_by_id = creator.id
       WHERE tp.id = $1`,
      [id]
    );

    if (prospectResult.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Prospect not found' });
    }

    const prospect = prospectResult.rows[0];

    // Get organization social profiles
    const socialProfilesResult = await pool.query(
      `SELECT platform, profile_url as link 
       FROM organization_social_profiles 
       WHERE organization_id = $1`,
      [prospect.organization_id]
    );

    // Get all contacts for organization
    const contactsResult = await pool.query(
      `SELECT c.*, oac.is_primary
       FROM contacts c
       JOIN organization_associated_contacts oac ON c.id = oac.contact_id
       WHERE oac.organization_id = $1 AND c.id != $2
       ORDER BY oac.is_primary DESC, c.full_name`,
      [prospect.organization_id, prospect.primary_contact_id]
    );

    // Get phone numbers and emails for primary contact
    const phoneNumbersResult = await pool.query(
      `SELECT phone, is_primary_phone 
       FROM contact_phone_numbers 
       WHERE contact_id = $1`,
      [prospect.primary_contact_id]
    );

    const emailAddressesResult = await pool.query(
      `SELECT email_id, is_primary 
       FROM contact_email_addresses 
       WHERE contact_id = $1`,
      [prospect.primary_contact_id]
    );

    res.json({
      success: true,
      data: {
        prospect: {
          id: prospect.id,
          prospect_code: prospect.prospect_code,
          status: prospect.status,
          sub_status: prospect.sub_status,
          assigned_to: prospect.assigned_to_id,
          assigned_to_name: prospect.assigned_to_name,
          assigned_on: prospect.assigned_date,
          creation: prospect.created_at,
          owner: prospect.created_by_id,
          owner_name: prospect.owner_name,
          modified: prospect.updated_at,
          modified_by: null // No modified_by_id column in tallac_prospects table
        },
        organization: {
          id: prospect.organization_id,
          organization_name: prospect.organization_name,
          industry: prospect.industry || prospect.industry_name,
          industry_id: prospect.industry_id,
          city: prospect.city,
          state: prospect.state,
          zip_code: prospect.zip_code,
          territory: prospect.territory_id,
          overview: prospect.overview,
          employee_size: prospect.employee_size,
          revenue: prospect.revenue,
          founded_date: prospect.founded_date,
          social_profiles: socialProfilesResult.rows
        },
        primary_contact: prospect.primary_contact_id ? {
          id: prospect.primary_contact_id,
          full_name: prospect.full_name,
          designation: prospect.designation,
          email_id: emailAddressesResult.rows.find(e => e.is_primary)?.email_id,
          mobile_no: phoneNumbersResult.rows.find(p => p.is_primary_phone)?.phone,
          phone_nos: phoneNumbersResult.rows,
          email_ids: emailAddressesResult.rows
        } : null,
        contacts: await (async () => {
          // OPTIMIZED: Batch query all phone numbers and emails for all contacts at once
          const contactIds = contactsResult.rows.map(c => c.id);
          if (contactIds.length === 0) return [];
          
          // Batch query all phones and emails in parallel
          const [phonesResult, emailsResult] = await Promise.all([
            pool.query(
              `SELECT contact_id, phone, is_primary_phone 
               FROM contact_phone_numbers 
               WHERE contact_id = ANY($1)`,
              [contactIds]
            ),
            pool.query(
              `SELECT contact_id, email_id, is_primary 
               FROM contact_email_addresses 
               WHERE contact_id = ANY($1)`,
              [contactIds]
            )
          ]);
          
          // Group phones and emails by contact_id
          const phonesByContact = {};
          for (const phone of phonesResult.rows) {
            if (!phonesByContact[phone.contact_id]) {
              phonesByContact[phone.contact_id] = [];
            }
            phonesByContact[phone.contact_id].push({
              phone: phone.phone,
              is_primary_phone: phone.is_primary_phone
            });
          }
          const emailsByContact = {};
          for (const email of emailsResult.rows) {
            if (!emailsByContact[email.contact_id]) {
              emailsByContact[email.contact_id] = [];
            }
            emailsByContact[email.contact_id].push({
              email_id: email.email_id,
              is_primary: email.is_primary
            });
          }
          
          // Enrich contacts with batch-queried data
          return contactsResult.rows.map(contact => ({
          id: contact.id,
          full_name: contact.full_name,
          first_name: contact.first_name,
          last_name: contact.last_name,
          designation: contact.designation,
            email_id: emailsByContact[contact.id]?.find(e => e.is_primary)?.email_id || contact.email_id,
            mobile_no: phonesByContact[contact.id]?.find(p => p.is_primary_phone)?.phone || contact.mobile_no,
            phone_nos: phonesByContact[contact.id] || [],
            email_ids: emailsByContact[contact.id] || []
          }));
        })()
      }
    });
  } catch (error) {
    console.error('Get prospect details error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch prospect details', error: error.message });
  }
});

// Create prospect
router.post('/', authenticateToken, async (req, res) => {
  try {
    console.log('\n=== CREATE PROSPECT API CALL ===');
    console.log('Request Body:', JSON.stringify(req.body, null, 2));
    console.log('User ID:', req.user.id);
    console.log('User Role:', req.user.tallac_role);
    
    const {
      organization_id,
      organization: organizationField, // Vue3/Python compatibility - accepts both organization_id and organization
      contact_id,
      contact: contactField, // Vue3/Python compatibility - accepts both contact_id and contact
      company_name,
      industry,
      address,
      city,
      state,
      zip_code,
      lead_name,
      title,
      phones,
      emails,
      status,
      territories,
      territory, // Vue3/Python compatibility - accepts both territories array and single territory
      company_overview,
      organization_data, // For creating organization from frontend
      contact_data // For creating contact from frontend
    } = req.body;

    // Normalize organization ID (handle both organization_id and organization field)
    const finalOrgId = organization_id || organizationField;
    console.log('Final Organization ID:', finalOrgId);
    
    // Normalize contact ID (handle both contact_id and contact field)
    const finalContactId = contact_id || contactField;
    console.log('Final Contact ID:', finalContactId);
    
    // Normalize territories (handle both territories array and single territory field)
    // Vue3 sends territories as array, Python might send as single value
    let finalTerritories = territories;
    if (!finalTerritories && territory) {
      // If territories not provided but territory is, convert to array
      finalTerritories = Array.isArray(territory) ? territory : [territory];
    }
    if (finalTerritories && !Array.isArray(finalTerritories)) {
      // Ensure it's an array
      finalTerritories = [finalTerritories];
    }
    // Filter out empty/null/undefined values
    if (finalTerritories) {
      finalTerritories = finalTerritories.filter(t => t != null && t !== '' && t !== undefined);
    }
    
    console.log('Territories (raw):', territories);
    console.log('Territory (raw):', territory);
    console.log('Final Territories (normalized):', finalTerritories);
    console.log('Status:', status);

    let organization;
    let primaryContact;

    // Check if organization exists or create new
    if (finalOrgId && !finalOrgId.toString().startsWith('TEMP-')) {
      // Existing organization (not TEMP)
      console.log('Looking for existing organization with ID:', finalOrgId);
      const orgResult = await pool.query('SELECT * FROM tallac_organizations WHERE id = $1', [finalOrgId]);
      if (orgResult.rows.length === 0) {
        console.error('Organization not found with ID:', finalOrgId);
        return res.status(404).json({ success: false, message: 'Organization not found' });
      }
      organization = orgResult.rows[0];
      console.log('Found existing organization:', organization.organization_name, 'ID:', organization.id);
    } else {
      // Create new organization from organization_data or individual fields
      const orgData = organization_data || {};
      const orgName = orgData.organization_name || company_name;
      const orgZip = orgData.zip_code || zip_code;
      
      // Company name is always required (like Vue3)
      if (!orgName) {
        return res.status(400).json({ success: false, message: 'Company name is required' });
      }

      // Zip code handling (like Vue3/Python):
      // - If zip_code provided, check if it exists in zipcodes table
      // - Only set zip_code in organization if it exists in zipcodes table
      // - Get territory from zip code if it exists
      let territoryId = null;
      let finalZipCode = null;
      
      if (orgZip) {
        // Check if zip code exists in zipcodes table
        const zipExistsResult = await pool.query(
          'SELECT zip_code FROM tallac_zipcodes WHERE zip_code = $1',
          [orgZip]
        );
        
        if (zipExistsResult.rows.length > 0) {
          // Zip code exists, use it
          finalZipCode = orgZip;
          
          // Try to get territory from zip code
          const zipResult = await pool.query(
            `SELECT t.id 
             FROM tallac_zipcodes tz
             JOIN territory_zipcodes ttz ON tz.zip_code = ttz.zip_code
             JOIN tallac_territories t ON ttz.territory_id = t.id
             WHERE tz.zip_code = $1 LIMIT 1`,
            [orgZip]
          );

          if (zipResult.rows.length > 0) {
            territoryId = zipResult.rows[0].id;
          }
        }
        // If zip code doesn't exist in zipcodes table, finalZipCode remains null (like Vue3/Python)
      }

      // Check if organization already exists (case-insensitive, trim whitespace)
      // Python flow: Check by name AND zip_code (if zip_code provided)
      const trimmedOrgName = orgName.trim();
      let existingOrgResult;
      
      if (finalZipCode) {
        // Check by name AND zip_code (like Python)
        existingOrgResult = await pool.query(
          'SELECT * FROM tallac_organizations WHERE TRIM(LOWER(organization_name)) = TRIM(LOWER($1)) AND zip_code = $2',
          [trimmedOrgName, finalZipCode]
        );
      }
      
      // If not found by name+zip, check by name only (like Python fallback)
      if (!existingOrgResult || existingOrgResult.rows.length === 0) {
        existingOrgResult = await pool.query(
          'SELECT * FROM tallac_organizations WHERE TRIM(LOWER(organization_name)) = TRIM(LOWER($1))',
          [trimmedOrgName]
        );
      }

      if (existingOrgResult.rows.length > 0) {
        // Organization already exists, use it
        organization = existingOrgResult.rows[0];
        console.log(`Organization "${trimmedOrgName}" already exists, using existing organization ID: ${organization.id}`);
      } else {
      // Get or create industry
      const orgIndustry = orgData.industry || industry;
      let industryId = null;
      if (orgIndustry) {
        const industryResult = await pool.query(
          'SELECT id FROM tallac_industries WHERE industry_code = $1 OR industry_name = $1',
          [orgIndustry]
        );

        if (industryResult.rows.length > 0) {
          industryId = industryResult.rows[0].id;
        } else {
          // Create new industry
          const newIndustryResult = await pool.query(
            `INSERT INTO tallac_industries (industry_code, industry_name) 
             VALUES ($1, $2) RETURNING id`,
            [orgIndustry, orgIndustry]
          );
          industryId = newIndustryResult.rows[0].id;
        }
      }

        // Create new organization
      const orgResult = await pool.query(
        `INSERT INTO tallac_organizations 
         (organization_name, industry, industry_id, address_line_1, city, state, zip_code, territory_id, overview, organization_owner_id, employee_size, revenue)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
         RETURNING *`,
        [
            trimmedOrgName,
          orgIndustry || null,
          industryId,
          orgData.address_line_1 || address || null,
          orgData.city || city || null,
          orgData.state || state || null,
          finalZipCode, // Only set if exists in zipcodes table, otherwise null (like Vue3/Python)
          orgData.territory_id || territoryId,
          orgData.overview || company_overview || null,
          req.user.id,
          orgData.employee_size || null,
          orgData.revenue || null
        ]
      );
      organization = orgResult.rows[0];
        console.log(`Created new organization: "${trimmedOrgName}" with ID: ${organization.id}`);
      }
    }

    // Create or get contact
    if (finalContactId && !finalContactId.toString().startsWith('TEMP-')) {
      // Existing contact (not TEMP)
      console.log('Looking for existing contact with ID:', finalContactId);
      const contactResult = await pool.query('SELECT * FROM contacts WHERE id = $1', [finalContactId]);
      if (contactResult.rows.length === 0) {
        console.warn('Contact not found with ID:', finalContactId, '- continuing without contact');
        // Don't fail if contact not found, just continue without it
        primaryContact = null;
      } else {
      primaryContact = contactResult.rows[0];
        console.log('Found existing contact:', primaryContact.full_name, 'ID:', primaryContact.id);
      }
    } else if (contact_data || lead_name) {
      // Create new contact from contact_data or individual fields
      const contData = contact_data || {};
      const contactName = contData.full_name || lead_name;
      const contactTitle = contData.designation || title;
      const contactPhones = contData.phones || phones || [];
      const contactEmails = contData.emails || emails || [];
      
      if (!contactName) {
        return res.status(400).json({ success: false, message: 'Contact name is required' });
      }
      
      const nameParts = contactName.split(' ');
      const firstName = nameParts[0] || '';
      const lastName = nameParts.slice(1).join(' ') || '';

      // Check if contact already exists (like Python does)
      let existingContactResult;
      if (lastName) {
        existingContactResult = await pool.query(
          'SELECT * FROM contacts WHERE first_name = $1 AND last_name = $2',
          [firstName, lastName]
        );
      } else {
        existingContactResult = await pool.query(
          'SELECT * FROM contacts WHERE first_name = $1 AND (last_name IS NULL OR last_name = \'\')',
          [firstName]
        );
      }

      if (existingContactResult.rows.length > 0) {
        // Contact already exists, use it and update if needed (like Python)
        primaryContact = existingContactResult.rows[0];
        console.log(`Contact "${contactName}" already exists, using existing contact ID: ${primaryContact.id}`);
        
        // Check if contact is linked to this organization
        const linkCheck = await pool.query(
          `SELECT * FROM contact_links 
           WHERE contact_id = $1 AND link_doctype = 'Tallac Organization' AND link_name = $2`,
          [primaryContact.id, organization.id]
        );
        
        if (linkCheck.rows.length === 0) {
          // Link contact to organization if not already linked
          await pool.query(
            `INSERT INTO contact_links (contact_id, link_doctype, link_name)
             VALUES ($1, 'Tallac Organization', $2)`,
            [primaryContact.id, organization.id]
          );
        }
        
        // Get existing phone numbers and emails to avoid duplicates
        const existingPhonesResult = await pool.query(
          'SELECT phone FROM contact_phone_numbers WHERE contact_id = $1',
          [primaryContact.id]
        );
        const existingPhones = new Set(existingPhonesResult.rows.map(p => p.phone));
        
        const existingEmailsResult = await pool.query(
          'SELECT email_id FROM contact_email_addresses WHERE contact_id = $1',
          [primaryContact.id]
        );
        const existingEmails = new Set(existingEmailsResult.rows.map(e => e.email_id));
        
        // Add new phone numbers that don't already exist
        if (contactPhones && Array.isArray(contactPhones)) {
          for (const phone of contactPhones) {
            const phoneNumber = phone.phone || phone.number;
            if (phoneNumber && !existingPhones.has(phoneNumber)) {
              await pool.query(
                `INSERT INTO contact_phone_numbers (contact_id, phone, is_primary_phone)
                 VALUES ($1, $2, $3)
                 ON CONFLICT DO NOTHING`,
                [primaryContact.id, phoneNumber, phone.is_primary_phone || phone.isPrimary || false]
              );
            }
          }
        }

        // Add new email addresses that don't already exist
        if (contactEmails && Array.isArray(contactEmails)) {
          for (const email of contactEmails) {
            const emailAddress = email.email_id || email.address;
            if (emailAddress && !existingEmails.has(emailAddress)) {
              await pool.query(
                `INSERT INTO contact_email_addresses (contact_id, email_id, is_primary)
                 VALUES ($1, $2, $3)
                 ON CONFLICT DO NOTHING`,
                [primaryContact.id, emailAddress, email.is_primary || email.isPrimary || false]
              );
            }
          }
        }
      } else {
        // Create new contact
      const contactResult = await pool.query(
        `INSERT INTO contacts (first_name, last_name, full_name, designation, is_primary_contact, status)
           VALUES ($1, $2, $3, $4, true, 'Active')
         RETURNING *`,
        [firstName, lastName, contactName, contactTitle || null]
      );
      primaryContact = contactResult.rows[0];
        console.log(`Created new contact: "${contactName}" with ID: ${primaryContact.id}`);

      // Add phone numbers
      if (contactPhones && Array.isArray(contactPhones)) {
        for (const phone of contactPhones) {
          const phoneNumber = phone.phone || phone.number;
          if (phoneNumber) {
          await pool.query(
            `INSERT INTO contact_phone_numbers (contact_id, phone, is_primary_phone)
             VALUES ($1, $2, $3)`,
              [primaryContact.id, phoneNumber, phone.is_primary_phone || phone.isPrimary || false]
          );
          }
        }
      }

      // Add email addresses
      if (contactEmails && Array.isArray(contactEmails)) {
        for (const email of contactEmails) {
          const emailAddress = email.email_id || email.address;
          if (emailAddress) {
          await pool.query(
            `INSERT INTO contact_email_addresses (contact_id, email_id, is_primary)
             VALUES ($1, $2, $3)`,
              [primaryContact.id, emailAddress, email.is_primary || email.isPrimary || false]
          );
          }
        }
      }

      // Link contact to organization
      await pool.query(
        `INSERT INTO contact_links (contact_id, link_doctype, link_name)
         VALUES ($1, 'Tallac Organization', $2)`,
        [primaryContact.id, organization.id]
      );
      }

      // Always ensure contact is in organization_associated_contacts
      await pool.query(
        `INSERT INTO organization_associated_contacts (organization_id, contact_id, is_primary)
         VALUES ($1, $2, true)
         ON CONFLICT (organization_id, contact_id) DO UPDATE SET is_primary = true`,
        [organization.id, primaryContact.id]
      );

      // Update organization primary contact if not already set
      const orgCheck = await pool.query(
        'SELECT primary_contact_id FROM tallac_organizations WHERE id = $1',
        [organization.id]
      );
      if (!orgCheck.rows[0]?.primary_contact_id) {
      await pool.query(
        `UPDATE tallac_organizations SET primary_contact_id = $1 WHERE id = $2`,
        [primaryContact.id, organization.id]
      );
    }
    }

    // Python/Vue3 flow: Always create prospect if organization exists
    // Territories are optional - if provided, use them; otherwise use organization's territory
    // Check if prospect already exists for this organization (like Python does - simple check by organization only)
    const existingProspectResult = await pool.query(
      'SELECT id FROM tallac_prospects WHERE organization_id = $1 LIMIT 1',
      [organization.id]
    );

    if (existingProspectResult.rows.length > 0) {
      console.log('Prospect already exists for organization:', organization.id);
      return res.json({
        success: true,
        prospect_id: existingProspectResult.rows[0].id,
        organization_id: organization.id,
        primary_contact_id: primaryContact?.id,
        message: 'Prospect already exists'
      });
    }

    console.log('Proceeding with prospect creation');

    // Handle territories (like Python: territories are optional, used for tags)
    // Python flow: If territories provided, update organization with first territory
    // Otherwise, use organization's existing territory (from zip code or existing)
    let territoryId = organization.territory_id;
    if (finalTerritories && finalTerritories.length > 0) {
      territoryId = finalTerritories[0]; // Use first territory
      if (territoryId && territoryId !== organization.territory_id) {
        await pool.query(
          'UPDATE tallac_organizations SET territory_id = $1 WHERE id = $2',
          [territoryId, organization.id]
        );
        organization.territory_id = territoryId;
      }
    }

    // When creating prospect, zip_code is required for territory lookup
    // If organization doesn't have zip_code, try to use the one from request
    if (!organization.zip_code && (zip_code || (organization_data && organization_data.zip_code))) {
      const prospectZip = zip_code || (organization_data && organization_data.zip_code);
      // Update organization with zip_code if provided
      if (prospectZip) {
        await pool.query(
          'UPDATE tallac_organizations SET zip_code = $1 WHERE id = $2',
          [prospectZip, organization.id]
        );
        organization.zip_code = prospectZip;
      }
    }

    // Python flow: Duplicate check is already done above (by organization only, like Python)
    // No need for additional contact+territory combination check

    // Create prospect
    console.log('Creating new prospect...');
    console.log('Prospect Data:', {
        organization_id: organization.id,
      primary_contact_id: primaryContact?.id || null,
      status: status || 'New',
      assigned_to_id: req.user.id,
      internal_notes: company_overview || '',
      created_by_id: req.user.id,
      created_by_role: req.user.tallac_role
    });
    
    // Prospect code will be auto-generated by trigger, so we don't specify it (leave it NULL or omit from INSERT)
    const prospectResult = await pool.query(
      `INSERT INTO tallac_prospects 
       (organization_id, primary_contact_id, status, sub_status, source, assigned_to_id, internal_notes, created_by_id, created_by_role)
       VALUES ($1, $2, $3, 'Needs Analysis', 'Web Form', $4, $5, $6, $7)
       RETURNING *`,
      [
        organization.id,
        primaryContact?.id || null,
        status || 'New',
        req.user.id,
        company_overview || '',
        req.user.id,
        req.user.tallac_role
      ]
    );

    console.log('✓ Prospect created successfully!');
    console.log('Prospect ID:', prospectResult.rows[0].id);
    console.log('=== CREATE PROSPECT SUCCESS ===\n');

    res.status(201).json({
      success: true,
      prospect_id: prospectResult.rows[0].id,
      organization_id: organization.id,
      primary_contact_id: primaryContact?.id,
      message: 'Prospect created successfully'
    });
  } catch (error) {
    console.error('\n=== CREATE PROSPECT ERROR ===');
    console.error('Error:', error);
    console.error('Error Message:', error.message);
    console.error('Error Stack:', error.stack);
    console.error('Request Body:', JSON.stringify(req.body, null, 2));
    console.error('=== CREATE PROSPECT ERROR END ===\n');
    res.status(500).json({ success: false, message: 'Failed to create prospect', error: error.message });
  }
});

// Update prospect
router.put('/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const updates = req.body;

    const allowedFields = [
      'status', 'sub_status', 'source', 'assigned_to_id', 'assigned_date',
      'last_call_date', 'last_call_outcome', 'last_notes', 'callback_date',
      'callback_time', 'next_action', 'internal_notes'
    ];

    const updateFields = [];
    const params = [];
    let paramCount = 1;

    for (const field of allowedFields) {
      if (updates[field] !== undefined) {
        updateFields.push(`${field} = $${paramCount}`);
        params.push(updates[field]);
        paramCount++;
      }
    }

    if (updateFields.length === 0) {
      return res.status(400).json({ success: false, message: 'No valid fields to update' });
    }

    params.push(id);
    const result = await pool.query(
      `UPDATE tallac_prospects 
       SET ${updateFields.join(', ')}, updated_at = CURRENT_TIMESTAMP
       WHERE id = $${paramCount}
       RETURNING *`,
      params
    );

    res.json({
      success: true,
      data: result.rows[0]
    });
  } catch (error) {
    console.error('Update prospect error:', error);
    res.status(500).json({ success: false, message: 'Failed to update prospect', error: error.message });
  }
});

// Delete prospect
router.delete('/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;

    await pool.query('DELETE FROM tallac_prospects WHERE id = $1', [id]);

    res.json({
      success: true,
      message: 'Prospect deleted successfully'
    });
  } catch (error) {
    console.error('Delete prospect error:', error);
    res.status(500).json({ success: false, message: 'Failed to delete prospect', error: error.message });
  }
});

// Manage organization links (social profiles)
router.post('/organization/:id/links', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { action, link_data } = req.body;

    if (action === 'add') {
      await pool.query(
        `INSERT INTO organization_social_profiles (organization_id, platform, profile_url)
         VALUES ($1, $2, $3)`,
        [id, link_data.platform, link_data.link]
      );
    } else if (action === 'remove') {
      await pool.query(
        `DELETE FROM organization_social_profiles 
         WHERE organization_id = $1 AND platform = $2 AND profile_url = $3`,
        [id, link_data.platform, link_data.link]
      );
    }

    res.json({
      success: true,
      message: 'Links updated successfully'
    });
  } catch (error) {
    console.error('Manage organization links error:', error);
    res.status(500).json({ success: false, message: 'Failed to manage links', error: error.message });
  }
});

// Get organization contacts
router.get('/organization/:id/contacts', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;

    const result = await pool.query(
      `SELECT c.*, oac.is_primary
       FROM contacts c
       JOIN organization_associated_contacts oac ON c.id = oac.contact_id
       WHERE oac.organization_id = $1
       ORDER BY oac.is_primary DESC, c.full_name`,
      [id]
    );

    // OPTIMIZED: Batch query all phone numbers and emails at once
    const contactIds = result.rows.map(c => c.id);
    const allPhonesResult = contactIds.length > 0 ? await pool.query(
      `SELECT contact_id, phone, is_primary_phone 
       FROM contact_phone_numbers 
       WHERE contact_id = ANY($1)`,
      [contactIds]
    ) : { rows: [] };
    const allEmailsResult = contactIds.length > 0 ? await pool.query(
      `SELECT contact_id, email_id, is_primary 
       FROM contact_email_addresses 
       WHERE contact_id = ANY($1)`,
      [contactIds]
    ) : { rows: [] };

    // Group phones and emails by contact_id
    const phonesByContact = {};
    for (const phone of allPhonesResult.rows) {
      if (!phonesByContact[phone.contact_id]) {
        phonesByContact[phone.contact_id] = [];
      }
      phonesByContact[phone.contact_id].push({
        phone: phone.phone,
        is_primary_phone: phone.is_primary_phone
      });
    }
    const emailsByContact = {};
    for (const email of allEmailsResult.rows) {
      if (!emailsByContact[email.contact_id]) {
        emailsByContact[email.contact_id] = [];
      }
      emailsByContact[email.contact_id].push({
        email_id: email.email_id,
        is_primary: email.is_primary
      });
    }

    // Enrich contacts with batch-queried data
    for (const contact of result.rows) {
      contact.phone_nos = phonesByContact[contact.id] || [];
      contact.email_ids = emailsByContact[contact.id] || [];
    }

    res.json({
      success: true,
      data: result.rows
    });
  } catch (error) {
    console.error('Get organization contacts error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch contacts', error: error.message });
  }
});

// Set organization primary contact
router.put('/organization/:id/primary-contact', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { contact_id } = req.body;

    // Update organization
    await pool.query(
      `UPDATE tallac_organizations SET primary_contact_id = $1 WHERE id = $2`,
      [contact_id, id]
    );

    // Update associated contacts table
    await pool.query(
      `UPDATE organization_associated_contacts SET is_primary = false WHERE organization_id = $1`,
      [id]
    );

    await pool.query(
      `UPDATE organization_associated_contacts SET is_primary = true 
       WHERE organization_id = $1 AND contact_id = $2`,
      [id, contact_id]
    );

    // Update prospect if linked
    await pool.query(
      `UPDATE tallac_prospects SET primary_contact_id = $1 WHERE organization_id = $2`,
      [contact_id, id]
    );

    res.json({
      success: true,
      message: 'Primary contact updated successfully'
    });
  } catch (error) {
    console.error('Set primary contact error:', error);
    res.status(500).json({ success: false, message: 'Failed to set primary contact', error: error.message });
  }
});

// Update contact
router.put('/contact/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { 
      full_name, first_name, last_name, designation, phones, emails, 
      preferred_call_time, organization_id, contact_name 
    } = req.body;

    // Get old contact data for activity tracking
    const oldContactResult = await pool.query(
      `SELECT c.*, 
              (SELECT array_agg(phone) FROM contact_phone_numbers WHERE contact_id = c.id) as old_phones,
              (SELECT array_agg(email_id) FROM contact_email_addresses WHERE contact_id = c.id) as old_emails
       FROM contacts c WHERE c.id = $1`,
      [id]
    );

    if (oldContactResult.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Contact not found' });
    }

    const oldContact = oldContactResult.rows[0];

    // Update contact basic info
    const updateFields = [];
    const params = [];
    let paramCount = 1;

    if (full_name !== undefined) {
      updateFields.push(`full_name = $${paramCount}`);
      params.push(full_name);
      paramCount++;
    }

    if (first_name !== undefined) {
      updateFields.push(`first_name = $${paramCount}`);
      params.push(first_name);
      paramCount++;
    }

    if (last_name !== undefined) {
      updateFields.push(`last_name = $${paramCount}`);
      params.push(last_name);
      paramCount++;
    }

    if (designation !== undefined) {
      updateFields.push(`designation = $${paramCount}`);
      params.push(designation);
      paramCount++;
    }

    if (preferred_call_time !== undefined) {
      updateFields.push(`preferred_call_time = $${paramCount}`);
      params.push(preferred_call_time);
      paramCount++;
    }

    if (updateFields.length > 0) {
      params.push(id);
      await pool.query(
        `UPDATE contacts SET ${updateFields.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = $${paramCount}`,
        params
      );
    }

    // Update phone numbers
    if (phones && Array.isArray(phones)) {
      // Delete old phone numbers
      await pool.query('DELETE FROM contact_phone_numbers WHERE contact_id = $1', [id]);
      
      // Insert new phone numbers
      for (const phoneData of phones) {
        if (phoneData.phone && phoneData.phone.trim()) {
          await pool.query(
            `INSERT INTO contact_phone_numbers (contact_id, phone, is_primary_phone)
             VALUES ($1, $2, $3)`,
            [id, phoneData.phone.trim(), phoneData.is_primary_phone || 0]
          );
        }
      }
    }

    // Update email addresses
    if (emails && Array.isArray(emails)) {
      // Delete old email addresses
      await pool.query('DELETE FROM contact_email_addresses WHERE contact_id = $1', [id]);
      
      // Insert new email addresses
      for (const emailData of emails) {
        if (emailData.email_id && emailData.email_id.trim()) {
          await pool.query(
            `INSERT INTO contact_email_addresses (contact_id, email_id, is_primary)
             VALUES ($1, $2, $3)`,
            [id, emailData.email_id.trim(), emailData.is_primary || 0]
          );
        }
      }
    }

    // Get updated contact
    const updatedContactResult = await pool.query(
      `SELECT c.*, 
              (SELECT array_agg(json_build_object('phone', phone, 'is_primary_phone', is_primary_phone)) 
               FROM contact_phone_numbers WHERE contact_id = c.id) as phone_nos,
              (SELECT array_agg(json_build_object('email_id', email_id, 'is_primary', is_primary)) 
               FROM contact_email_addresses WHERE contact_id = c.id) as email_ids
       FROM contacts c WHERE c.id = $1`,
      [id]
    );

    const updatedContact = updatedContactResult.rows[0];

    // Find associated prospect for activity creation
    let prospectId = null;
    if (organization_id) {
      const prospectResult = await pool.query(
        `SELECT id FROM tallac_prospects WHERE organization_id = $1 LIMIT 1`,
        [organization_id]
      );
      if (prospectResult.rows.length > 0) {
        prospectId = prospectResult.rows[0].id;
      }
    }

    // Create activity for contact changes
    const changes = [];
    if (full_name !== undefined && full_name !== oldContact.full_name) {
      changes.push(`Full Name: ${oldContact.full_name || '(empty)'} → ${full_name || '(empty)'}`);
    }
    if (designation !== undefined && designation !== oldContact.designation) {
      changes.push(`Designation: ${oldContact.designation || '(empty)'} → ${designation || '(empty)'}`);
    }
    if (phones && Array.isArray(phones)) {
      const oldPhones = oldContact.old_phones || [];
      const newPhones = phones.map(p => p.phone).filter(Boolean);
      if (JSON.stringify(oldPhones.sort()) !== JSON.stringify(newPhones.sort())) {
        changes.push(`Phone Numbers: Updated`);
      }
    }
    if (emails && Array.isArray(emails)) {
      const oldEmails = oldContact.old_emails || [];
      const newEmails = emails.map(e => e.email_id).filter(Boolean);
      if (JSON.stringify(oldEmails.sort()) !== JSON.stringify(newEmails.sort())) {
        changes.push(`Email Addresses: Updated`);
      }
    }

    if (changes.length > 0 && prospectId) {
      // Get 'Completed' status_id
      const statusResult = await pool.query(
        `SELECT id FROM activity_statuses WHERE status_name = 'Completed'`,
        []
      );
      const statusId = statusResult.rows[0]?.id || null;

      const activityDescription = `<p>Contact <strong>${updatedContact.full_name || contact_name || 'Unknown'}</strong> updated:</p>` +
        changes.map(change => `<p>${change}</p>`).join('');

      await pool.query(
        `INSERT INTO tallac_activities 
         (activity_type, title, status_id, reference_docname, reference_doctype, 
          organization_id, contact_person_id, description, assigned_to_id, created_by_id, 
          created_at, completed_on)
         VALUES ('Changes', $1, $2, $3, 'Prospect', $4, $5, $6, $7, $7, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
        [
          `Contact Updated: ${updatedContact.full_name || contact_name || 'Unknown'}`,
          statusId,
          prospectId,
          organization_id || null,
          id,
          activityDescription,
          req.user.id
        ]
      );
    }

    res.json({
      success: true,
      message: 'Contact updated successfully',
      data: updatedContact
    });
  } catch (error) {
    console.error('Update contact error:', error);
    res.status(500).json({ success: false, message: 'Failed to update contact', error: error.message });
  }
});

// Create call log
router.post('/:id/call-log', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { outcome, notes, duration, next_step, new_status } = req.body;

    // Get prospect
    const prospectResult = await pool.query(
      `SELECT organization_id, primary_contact_id FROM tallac_prospects WHERE id = $1`,
      [id]
    );

    if (prospectResult.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Prospect not found' });
    }

    const prospect = prospectResult.rows[0];

    // Map outcome
    const outcomeMap = {
      'connected': 'Connected',
      'no_answer': 'No Answer',
      'voicemail': 'Voicemail',
      'busy': 'No Answer',
      'wrong_number': 'Wrong Number',
      'dnd': 'No Answer'
    };

    const callOutcome = outcomeMap[outcome] || 'Connected';

    // Create call log activity
    const callLogResult = await pool.query(
      `INSERT INTO tallac_activities 
       (activity_type, subject, status, prospect_id, company_id, contact_id,
        start_time, call_outcome, description, assigned_to_id, created_by_id, date_time)
       VALUES ('Call Log', $1, 'Completed', $2, $3, $4, CURRENT_TIMESTAMP, $5, $6, $7, $7, CURRENT_TIMESTAMP)
       RETURNING *`,
      [
        `Call - ${callOutcome}`,
        id,
        prospect.organization_id,
        prospect.primary_contact_id,
        callOutcome,
        notes || null,
        req.user.id
      ]
    );

    // Create follow-up task if needed
    if (next_step && next_step.type) {
      await pool.query(
        `INSERT INTO tallac_activities 
         (activity_type, status, priority, prospect_id, company_id, contact_id,
          scheduled_date, scheduled_time, description, assigned_to_id, created_by_id, date_time)
         VALUES ($1, 'Open', 'Medium', $2, $3, $4, $5, $6, $7, $8, $8, CURRENT_TIMESTAMP)`,
        [
          next_step.type,
          id,
          prospect.organization_id,
          prospect.primary_contact_id,
          next_step.date,
          next_step.time,
          `Follow-up from call: ${notes || ''}`,
          req.user.id
        ]
      );
    }

    // Update prospect status if needed
    if (new_status) {
      await pool.query(
        `UPDATE tallac_prospects SET status = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2`,
        [new_status, id]
      );
    }

    res.json({
      success: true,
      message: 'Call log created successfully',
      data: callLogResult.rows[0]
    });
  } catch (error) {
    console.error('Create call log error:', error);
    res.status(500).json({ success: false, message: 'Failed to create call log', error: error.message });
  }
});

// Search organizations (separate from prospects search)
router.get('/organizations/search', authenticateToken, async (req, res) => {
  try {
    const { search, limit = 20 } = req.query;
    
    // Minimum 15 characters required (including spaces, but trimmed to avoid space-only queries)
    const trimmedSearch = search ? search.trim() : '';
    if (!trimmedSearch || trimmedSearch.length < 15) {
      return res.json({
        success: true,
        data: []
      });
    }

    // Build search query - support both full text search and word-based search
    // Split search into words and search for each word
    const searchWords = trimmedSearch.split(/\s+/).filter(w => w.length > 0);
    let whereClause = '';
    let queryParams = [];
    let paramCount = 1;

    if (searchWords.length === 1) {
      // Single word or phrase - use ILIKE
      whereClause = `to_org.organization_name ILIKE $${paramCount}`;
      queryParams.push(`%${trimmedSearch}%`);
      paramCount++;
    } else {
      // Multiple words - search for each word (AND condition)
      const conditions = searchWords.map((word, idx) => {
        const param = `$${paramCount}`;
        paramCount++;
        queryParams.push(`%${word}%`);
        return `to_org.organization_name ILIKE ${param}`;
      });
      whereClause = conditions.join(' AND ');
    }

    const query = `
      SELECT 
        to_org.id,
        to_org.organization_name,
        to_org.city,
        to_org.state,
        to_org.industry,
        to_org.zip_code,
        tt.id as territory_id,
        tt.territory_name,
        tt.territory_name as territory
      FROM tallac_organizations to_org
      LEFT JOIN tallac_territories tt ON to_org.territory_id = tt.id
      WHERE ${whereClause}
      ORDER BY 
        CASE 
          WHEN to_org.organization_name ILIKE $${paramCount} THEN 1
          ELSE 2
        END,
        to_org.organization_name ASC
      LIMIT $${paramCount + 1}
    `;

    // Add exact match for ordering
    queryParams.push(`${trimmedSearch}%`);
    queryParams.push(parseInt(limit));

    const result = await pool.query(query, queryParams);

    // For each organization, get contacts and territories
    const organizationsWithDetails = await Promise.all(
      result.rows.map(async (org) => {
        // Get contacts for this organization with email addresses
        const contactsResult = await pool.query(
          `SELECT DISTINCT
            c.id,
            c.full_name,
            c.designation,
            c.mobile_no,
            c.is_primary_contact,
            cea.email_id,
            cea.is_primary as is_primary_email
           FROM contacts c
           JOIN organization_associated_contacts oac ON c.id = oac.contact_id
           LEFT JOIN contact_email_addresses cea ON c.id = cea.contact_id AND cea.is_primary = true
           WHERE oac.organization_id = $1
           ORDER BY c.is_primary_contact DESC, c.full_name ASC`,
          [org.id]
        );

        // Get territory if exists
        const territory = org.territory_id ? {
          id: org.territory_id,
          territory_id: org.territory_id,
          territory_name: org.territory_name,
          territory: org.territory || org.territory_id
        } : null;

        return {
        id: org.id,
        name: org.id, // For compatibility with Vue3
        organization_name: org.organization_name,
        company_name: org.organization_name, // Alias for compatibility
        city: org.city,
        state: org.state,
        industry: org.industry,
        zip_code: org.zip_code,
        territory_id: org.territory_id,
        territory_name: org.territory_name,
          territory: org.territory || org.territory_id,
          contacts: contactsResult.rows,
          has_contacts: contactsResult.rows.length > 0,
          has_territory: !!org.territory_id,
          territory_data: territory
        };
      })
    );

    res.json({
      success: true,
      data: organizationsWithDetails
    });
  } catch (error) {
    console.error('Search organizations error:', error);
    res.status(500).json({ success: false, message: 'Failed to search organizations', error: error.message });
  }
});

export default router;

