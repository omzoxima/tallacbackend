import express from 'express';
import multer from 'multer';
import csv from 'csv-parser';
import { Readable } from 'stream';
import pool from '../config/database.js';
import { authenticateToken, requireRole } from '../middleware/auth.js';

const router = express.Router();

// Configure multer for file upload
const upload = multer({ storage: multer.memoryStorage() });

// Import prospects from CSV
router.post('/prospects', authenticateToken, requireRole('Corporate Admin', 'Territory Admin'), upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'CSV file is required' });
    }

    const results = {
      file_name: req.file.originalname,
      total_rows: 0,
      companies: {
        created: 0,
        already_exists: 0,
        updated: 0,
        failed: 0
      },
      prospects: {
        created: 0,
        already_exists: 0,
        failed: 0
      },
      contacts: {
        created: 0,
        updated: 0,
        skipped: 0,
        failed: 0
      },
      failed_records: []
    };

    const csvData = [];
    const stream = Readable.from(req.file.buffer.toString('utf-8'));

    // Parse CSV
    await new Promise((resolve, reject) => {
      stream
        .pipe(csv())
        .on('data', (row) => {
          csvData.push(row);
        })
        .on('end', resolve)
        .on('error', reject);
    });

    for (const row of csvData) {
      try {
        results.total_rows++;

        const companyName = row['Company Name'] || row['CompanyName'];
        if (!companyName) continue;

        const zipCode = row['ZIPCode'] || row['ZipCode'] || row['ZIP'];

        // Get or create organization
        let orgResult = await pool.query(
          `SELECT id FROM tallac_organizations WHERE organization_name = $1`,
          [companyName]
        );

        let organizationId;
        let orgIsNew = false;

        if (orgResult.rows.length === 0) {
          // Create new organization
          // Get territory from zipcode
          let territoryId = null;
          if (zipCode) {
            const territoryResult = await pool.query(
              `SELECT t.id 
               FROM tallac_zipcodes tz
               JOIN territory_zipcodes ttz ON tz.zip_code = ttz.zip_code
               JOIN tallac_territories t ON ttz.territory_id = t.id
               WHERE tz.zip_code = $1 LIMIT 1`,
              [zipCode]
            );
            if (territoryResult.rows.length > 0) {
              territoryId = territoryResult.rows[0].id;
            }
          }

          // Get or create industry
          let industryId = null;
          const industry = row['Industries'] || row['Industry'];
          if (industry) {
            const industryResult = await pool.query(
              'SELECT id FROM tallac_industries WHERE industry_code = $1 OR industry_name = $1',
              [industry]
            );

            if (industryResult.rows.length > 0) {
              industryId = industryResult.rows[0].id;
            } else {
              const newIndustryResult = await pool.query(
                `INSERT INTO tallac_industries (industry_code, industry_name) 
                 VALUES ($1, $2) RETURNING id`,
                [industry, industry]
              );
              industryId = newIndustryResult.rows[0].id;
            }
          }

          const orgInsertResult = await pool.query(
            `INSERT INTO tallac_organizations 
             (organization_name, industry_id, address_line_1, city, state, zip_code, 
              territory_id, overview, employee_size, revenue, founded_date, organization_owner_id, status)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'Prospect')
             RETURNING id`,
            [
              companyName,
              industryId,
              row['Address'] || null,
              row['City'] || null,
              row['State'] || null,
              zipCode || null,
              territoryId,
              row['Overview'] || row['Description'] || null,
              row['Employee'] || null,
              row['Revenue'] || null,
              row['Foundation'] ? (row['Foundation'].length === 4 ? `${row['Foundation']}-01-01` : row['Foundation']) : null,
              req.user.id
            ]
          );
          organizationId = orgInsertResult.rows[0].id;
          orgIsNew = true;
          results.companies.created++;
        } else {
          organizationId = orgResult.rows[0].id;
          results.companies.already_exists++;
        }

        // Create contact
        const firstName = row['First Name'] || '';
        const lastName = row['Last Name'] || '';
        const fullName = `${firstName} ${lastName}`.trim();

        let contactId = null;
        if (fullName) {
          // Check if contact exists
          const contactResult = await pool.query(
            `SELECT id FROM contacts WHERE first_name = $1 AND last_name = $2`,
            [firstName, lastName || '']
          );

          if (contactResult.rows.length === 0) {
            // Create new contact
            const newContactResult = await pool.query(
              `INSERT INTO contacts (first_name, last_name, full_name, designation, is_primary_contact, status)
               VALUES ($1, $2, $3, $4, true, 'Active')
               RETURNING id`,
              [firstName, lastName, fullName, row['Designation'] || null]
            );
            contactId = newContactResult.rows[0].id;
            results.contacts.created++;

            // Add phone numbers
            const phones = (row['Phones'] || '').split(',').map(p => p.trim()).filter(p => p);
            for (const phone of phones) {
              await pool.query(
                `INSERT INTO contact_phone_numbers (contact_id, phone, is_primary_phone)
                 VALUES ($1, $2, $3)`,
                [contactId, phone, phones.indexOf(phone) === 0]
              );
            }

            // Add email addresses
            const emails = (row['Emails'] || '').split(',').map(e => e.trim()).filter(e => e);
            for (const email of emails) {
              await pool.query(
                `INSERT INTO contact_email_addresses (contact_id, email_id, is_primary)
                 VALUES ($1, $2, $3)`,
                [contactId, email, emails.indexOf(email) === 0]
              );
            }

            // Link contact to organization
            await pool.query(
              `INSERT INTO contact_links (contact_id, link_doctype, link_name)
               VALUES ($1, 'Tallac Organization', $2)`,
              [contactId, organizationId]
            );

            await pool.query(
              `INSERT INTO organization_associated_contacts (organization_id, contact_id, is_primary)
               VALUES ($1, $2, true)
               ON CONFLICT (organization_id, contact_id) DO UPDATE SET is_primary = true`,
              [organizationId, contactId]
            );

            // Update organization primary contact
            await pool.query(
              `UPDATE tallac_organizations SET primary_contact_id = $1 WHERE id = $2`,
              [contactId, organizationId]
            );
          } else {
            contactId = contactResult.rows[0].id;
            results.contacts.skipped++;
          }
        }

        // Create prospect
        const existingProspectResult = await pool.query(
          'SELECT id FROM tallac_prospects WHERE organization_id = $1',
          [organizationId]
        );

        if (existingProspectResult.rows.length === 0) {
          await pool.query(
            `INSERT INTO tallac_prospects 
             (organization_id, primary_contact_id, status, sub_status, source, 
              assigned_to_id, internal_notes, created_by_id, created_by_role)
             VALUES ($1, $2, 'New', 'Needs Analysis', 'CSV Import', $3, $4, $3, $5)`,
            [
              organizationId,
              contactId,
              req.user.id,
              row['About'] || row['Overview'] || null,
              req.user.tallac_role
            ]
          );
          results.prospects.created++;
        } else {
          results.prospects.already_exists++;
        }

      } catch (error) {
        console.error('Error processing row:', error);
        results.failed_records.push({
          row_num: results.total_rows,
          company_name: row['Company Name'] || '',
          error_reason: error.message
        });

        if (orgIsNew) {
          results.companies.failed++;
        } else {
          results.prospects.failed++;
        }
      }
    }

    res.json({
      success: true,
      ...results
    });
  } catch (error) {
    console.error('Import prospects error:', error);
    res.status(500).json({ success: false, message: 'Failed to import prospects', error: error.message });
  }
});

export default router;

