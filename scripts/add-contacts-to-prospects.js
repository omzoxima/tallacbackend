import pool from '../config/database.js';

/**
 * Script to add contacts with phone numbers to existing prospects
 * This will:
 * 1. Find all prospects without primary contacts
 * 2. Create contacts for them with phone numbers
 * 3. Link contacts to organizations
 */

const phoneNumbers = [
  '+1-555-0101',
  '+1-555-0102',
  '+1-555-0103',
  '+1-555-0104',
  '+1-555-0105',
  '+1-555-0106',
  '+1-555-0107',
  '+1-555-0108',
  '+1-555-0109',
  '+1-555-0110',
  '+1-555-0111',
  '+1-555-0112',
  '+1-555-0113',
  '+1-555-0114',
  '+1-555-0115',
  '+1-555-0116',
  '+1-555-0117',
  '+1-555-0118',
  '+1-555-0119',
  '+1-555-0120',
];

const firstNames = [
  'John', 'Jane', 'Michael', 'Sarah', 'David', 'Emily', 'Robert', 'Jessica',
  'William', 'Ashley', 'James', 'Amanda', 'Christopher', 'Melissa', 'Daniel',
  'Michelle', 'Matthew', 'Kimberly', 'Anthony', 'Amy', 'Mark', 'Angela',
  'Donald', 'Stephanie', 'Steven', 'Nicole', 'Paul', 'Elizabeth', 'Andrew',
  'Helen', 'Joshua', 'Sandra', 'Kenneth', 'Donna', 'Kevin', 'Carol', 'Brian',
  'Ruth', 'George', 'Sharon', 'Edward', 'Laura', 'Ronald', 'Cynthia'
];

const lastNames = [
  'Smith', 'Johnson', 'Williams', 'Brown', 'Jones', 'Garcia', 'Miller', 'Davis',
  'Rodriguez', 'Martinez', 'Hernandez', 'Lopez', 'Wilson', 'Anderson', 'Thomas',
  'Taylor', 'Moore', 'Jackson', 'Martin', 'Lee', 'Thompson', 'White', 'Harris',
  'Sanchez', 'Clark', 'Ramirez', 'Lewis', 'Robinson', 'Walker', 'Young', 'Allen',
  'King', 'Wright', 'Scott', 'Torres', 'Nguyen', 'Hill', 'Flores', 'Green', 'Adams'
];

const titles = [
  'CEO', 'CTO', 'CFO', 'VP of Sales', 'VP of Marketing', 'Director of Operations',
  'Sales Manager', 'Marketing Manager', 'Operations Manager', 'Business Development Manager',
  'Account Executive', 'Sales Representative', 'Marketing Coordinator', 'Operations Coordinator'
];

function getRandomElement(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function generatePhoneNumber() {
  return getRandomElement(phoneNumbers);
}

function generateName() {
  const firstName = getRandomElement(firstNames);
  const lastName = getRandomElement(lastNames);
  return {
    firstName,
    lastName,
    fullName: `${firstName} ${lastName}`
  };
}

async function addContactsToProspects() {
  try {
    console.log('Starting to add contacts to prospects...');

    // Get all prospects that don't have primary contacts
    const prospectsResult = await pool.query(`
      SELECT 
        tp.id as prospect_id,
        tp.organization_id,
        to_org.organization_name
      FROM tallac_prospects tp
      JOIN tallac_organizations to_org ON tp.organization_id = to_org.id
      WHERE tp.primary_contact_id IS NULL
      ORDER BY tp.created_at DESC
    `);

    console.log(`Found ${prospectsResult.rows.length} prospects without primary contacts`);

    let successCount = 0;
    let errorCount = 0;

    for (const prospect of prospectsResult.rows) {
      try {
        // Generate contact name
        const name = generateName();
        const phone = generatePhoneNumber();
        const title = getRandomElement(titles);

        // Use a transaction to ensure all operations succeed or fail together
        const client = await pool.connect();
        try {
          await client.query('BEGIN');

          // Create contact
          const contactResult = await client.query(
            `INSERT INTO contacts (first_name, last_name, full_name, designation, is_primary_contact, status)
             VALUES ($1, $2, $3, $4, true, 'Passive')
             RETURNING id`,
            [name.firstName, name.lastName, name.fullName, title]
          );

          const contactId = contactResult.rows[0].id;

          // Add phone number
          await client.query(
            `INSERT INTO contact_phone_numbers (contact_id, phone, is_primary_phone)
             VALUES ($1, $2, true)`,
            [contactId, phone]
          );

          // Link contact to organization
          await client.query(
            `INSERT INTO contact_links (contact_id, link_doctype, link_name)
             VALUES ($1, 'Tallac Organization', $2)`,
            [contactId, prospect.organization_id]
          );

          // Add to organization associated contacts
          await client.query(
            `INSERT INTO organization_associated_contacts (organization_id, contact_id, is_primary)
             VALUES ($1, $2, true)
             ON CONFLICT (organization_id, contact_id) DO UPDATE SET is_primary = true`,
            [prospect.organization_id, contactId]
          );

          // Skip updating organization primary_contact_id to avoid foreign key constraint issues
          // The contact is still properly linked via organization_associated_contacts and prospect

          // Update prospect primary contact
          await client.query(
            `UPDATE tallac_prospects SET primary_contact_id = $1 WHERE id = $2`,
            [contactId, prospect.prospect_id]
          );

          await client.query('COMMIT');
          client.release();

          successCount++;
          console.log(`✓ Added contact "${name.fullName}" (${phone}) to prospect "${prospect.organization_name}"`);

        } catch (error) {
          await client.query('ROLLBACK');
          client.release();
          errorCount++;
          console.error(`✗ Error adding contact to prospect ${prospect.prospect_id}:`, error.message);
        }
      } catch (error) {
        errorCount++;
        console.error(`✗ Error processing prospect ${prospect.prospect_id}:`, error.message);
      }
    }

    console.log('\n=== Summary ===');
    console.log(`Successfully added contacts: ${successCount}`);
    console.log(`Errors: ${errorCount}`);
    console.log(`Total prospects processed: ${prospectsResult.rows.length}`);

  } catch (error) {
    console.error('Fatal error:', error);
  } finally {
    await pool.end();
    process.exit(0);
  }
}

// Run the script
addContactsToProspects();

