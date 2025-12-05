-- Seed Sample Organizations with Territory Assignment
-- This will create test companies similar to the screenshot

-- First, get territory IDs
DO $$
DECLARE
  west_coast_id UUID;
  east_coast_id UUID;
  midwest_id UUID;
  southwest_id UUID;
BEGIN
  -- Get territory IDs (these should already exist from previous migrations)
  SELECT id INTO west_coast_id FROM tallac_territories WHERE territory_name ILIKE '%west%' OR territory_name ILIKE '%california%' LIMIT 1;
  SELECT id INTO east_coast_id FROM tallac_territories WHERE territory_name ILIKE '%east%' OR territory_name ILIKE '%new york%' LIMIT 1;
  SELECT id INTO midwest_id FROM tallac_territories WHERE territory_name ILIKE '%midwest%' OR territory_name ILIKE '%chicago%' LIMIT 1;
  SELECT id INTO southwest_id FROM tallac_territories WHERE territory_name ILIKE '%south%' OR territory_name ILIKE '%texas%' LIMIT 1;

  -- If territories not found, use first available
  IF west_coast_id IS NULL THEN
    SELECT id INTO west_coast_id FROM tallac_territories LIMIT 1;
  END IF;
  
  IF east_coast_id IS NULL THEN
    SELECT id INTO east_coast_id FROM tallac_territories OFFSET 1 LIMIT 1;
  END IF;
  
  IF midwest_id IS NULL THEN
    SELECT id INTO midwest_id FROM tallac_territories OFFSET 2 LIMIT 1;
  END IF;

  -- Insert sample organizations
  INSERT INTO tallac_organizations (
    organization_name,
    doing_business_as,
    industry,
    organization_type,
    status,
    address_line_1,
    address_line_2,
    city,
    state,
    zip_code,
    territory_id,
    truck_count,
    driver_count,
    employee_size,
    revenue,
    founded_date,
    website,
    main_phone,
    email,
    overview
  ) VALUES
  
  -- 1. Health Plan of San Joaquin (like screenshot)
  (
    'Health Plan of San Joaquin',
    'HPSJ',
    'HEALTHCARE',
    'Corporation',
    'Active',
    '7751 S Manthey Rd',
    'Suite 200',
    'French Camp',
    'CA',
    '95231',
    west_coast_id,
    NULL,
    NULL,
    '201-500',
    '$50M - $100M',
    '1996-01-01',
    'https://www.hpsj.com',
    '+1-209-942-6300',
    'info@hpsj.com',
    'Health Plan of San Joaquin provides quality healthcare coverage to families and individuals in San Joaquin, Stanislaus, Merced, and Madera counties.'
  ),
  
  -- 2. ABC Logistics
  (
    'ABC Logistics Inc',
    'ABC Transport',
    'LOGISTICS',
    'LLC',
    'Active',
    '123 Commerce Street',
    NULL,
    'Los Angeles',
    'CA',
    '90001',
    west_coast_id,
    45,
    52,
    '51-200',
    '$5M - $10M',
    '2010-05-15',
    'https://www.abclogistics.com',
    '+1-213-555-0100',
    'contact@abclogistics.com',
    'Full-service logistics provider specializing in freight forwarding and warehousing solutions.'
  ),
  
  -- 3. Northern Trucking
  (
    'Northern Trucking Company',
    'NorthTruck',
    'TRUCKING',
    'Corporation',
    'Active',
    '456 Industrial Blvd',
    'Building A',
    'Sacramento',
    'CA',
    '95814',
    west_coast_id,
    78,
    95,
    '201-500',
    '$10M - $25M',
    '2005-03-20',
    'https://www.northerntrucking.com',
    '+1-916-555-0200',
    'info@northerntrucking.com',
    'Leading trucking company serving the western United States with a fleet of over 75 trucks.'
  ),
  
  -- 4. East Coast Distribution
  (
    'East Coast Distribution LLC',
    'ECD',
    'DISTRIBUTION',
    'LLC',
    'Active',
    '789 Harbor Drive',
    NULL,
    'Newark',
    'NJ',
    '07102',
    east_coast_id,
    25,
    30,
    '51-200',
    '$3M - $5M',
    '2015-08-10',
    'https://www.ecdistribution.com',
    '+1-973-555-0300',
    'sales@ecdistribution.com',
    'Regional distribution center serving the northeast corridor with comprehensive logistics solutions.'
  ),
  
  -- 5. Midwest Freight Services
  (
    'Midwest Freight Services',
    'MFS',
    'FREIGHT_FORWARDING',
    'Corporation',
    'Active',
    '321 Cargo Way',
    'Suite 500',
    'Chicago',
    'IL',
    '60601',
    midwest_id,
    60,
    70,
    '201-500',
    '$15M - $25M',
    '2008-11-05',
    'https://www.midwestfreight.com',
    '+1-312-555-0400',
    'info@midwestfreight.com',
    'Premier freight forwarding company with extensive network across the Midwest region.'
  ),
  
  -- 6. Pacific Warehousing
  (
    'Pacific Warehousing Solutions',
    'Pacific Warehouse',
    'WAREHOUSING',
    'LLC',
    'Active',
    '555 Storage Lane',
    NULL,
    'Seattle',
    'WA',
    '98101',
    west_coast_id,
    NULL,
    NULL,
    '51-200',
    '$2M - $5M',
    '2012-06-15',
    'https://www.pacificwarehouse.com',
    '+1-206-555-0500',
    'contact@pacificwarehouse.com',
    'Modern warehousing facilities with temperature-controlled storage and distribution capabilities.'
  ),
  
  -- 7. Swift Supply Chain
  (
    'Swift Supply Chain Management',
    'Swift SCM',
    'SUPPLY_CHAIN',
    'Corporation',
    'Active',
    '888 Logistics Parkway',
    'Floor 3',
    'Dallas',
    'TX',
    '75201',
    southwest_id,
    35,
    40,
    '101-500',
    '$8M - $15M',
    '2014-02-28',
    'https://www.swiftscm.com',
    '+1-214-555-0600',
    'hello@swiftscm.com',
    'End-to-end supply chain management solutions for businesses of all sizes.'
  ),
  
  -- 8. Last Mile Express
  (
    'Last Mile Express Delivery',
    'LME Delivery',
    'LAST_MILE',
    'LLC',
    'Active',
    '999 Delivery Road',
    NULL,
    'San Francisco',
    'CA',
    '94102',
    west_coast_id,
    20,
    25,
    '11-50',
    '$1M - $3M',
    '2018-09-12',
    'https://www.lastmileexpress.com',
    '+1-415-555-0700',
    'info@lastmileexpress.com',
    'Specialized last-mile delivery service with same-day and next-day options.'
  ),
  
  -- 9. Cold Chain Logistics
  (
    'Cold Chain Logistics Corp',
    'ColdChain',
    'COLD_CHAIN',
    'Corporation',
    'Active',
    '444 Refrigeration Ave',
    'Unit 10',
    'Portland',
    'OR',
    '97201',
    west_coast_id,
    15,
    18,
    '11-50',
    '$2M - $5M',
    '2016-04-20',
    'https://www.coldchainlogistics.com',
    '+1-503-555-0800',
    'contact@coldchainlogistics.com',
    'Temperature-controlled logistics for pharmaceutical and food industries.'
  ),
  
  -- 10. E-Commerce Fulfillment Hub
  (
    'E-Commerce Fulfillment Hub',
    'EFH',
    'E_COMMERCE_LOGISTICS',
    'LLC',
    'Prospect',
    '777 Commerce Plaza',
    NULL,
    'San Diego',
    'CA',
    '92101',
    west_coast_id,
    NULL,
    NULL,
    '51-200',
    '$5M - $10M',
    '2019-01-15',
    'https://www.efhub.com',
    '+1-619-555-0900',
    'sales@efhub.com',
    'Full-service e-commerce fulfillment with integrated warehouse management systems.'
  );

  RAISE NOTICE '✅ Successfully inserted 10 sample organizations!';
  
END $$;

-- Add some social profiles for the first few organizations
INSERT INTO tallac_organization_social_profiles (organization_id, platform, profile_url)
SELECT 
  o.id,
  'Website',
  o.website
FROM tallac_organizations o
WHERE o.website IS NOT NULL
ON CONFLICT (organization_id, platform, profile_url) DO NOTHING;

-- Add LinkedIn profiles for some companies
DO $$
DECLARE
  org_id UUID;
BEGIN
  -- Health Plan of San Joaquin
  SELECT id INTO org_id FROM tallac_organizations WHERE organization_name = 'Health Plan of San Joaquin';
  IF org_id IS NOT NULL THEN
    INSERT INTO tallac_organization_social_profiles (organization_id, platform, profile_url)
    VALUES (org_id, 'LinkedIn', 'https://www.linkedin.com/company/health-plan-of-san-joaquin')
    ON CONFLICT DO NOTHING;
  END IF;
  
  -- ABC Logistics
  SELECT id INTO org_id FROM tallac_organizations WHERE organization_name = 'ABC Logistics Inc';
  IF org_id IS NOT NULL THEN
    INSERT INTO tallac_organization_social_profiles (organization_id, platform, profile_url)
    VALUES 
      (org_id, 'LinkedIn', 'https://www.linkedin.com/company/abc-logistics'),
      (org_id, 'Facebook', 'https://www.facebook.com/abclogistics')
    ON CONFLICT DO NOTHING;
  END IF;
  
  RAISE NOTICE '✅ Social profiles added!';
END $$;

-- Display summary
SELECT 
  COUNT(*) as total_organizations,
  COUNT(CASE WHEN territory_id IS NOT NULL THEN 1 END) as with_territory,
  COUNT(CASE WHEN status = 'Active' THEN 1 END) as active_status
FROM tallac_organizations;

-- Show sample data
SELECT 
  organization_name,
  city,
  state,
  industry,
  CASE WHEN territory_id IS NOT NULL THEN 'Assigned' ELSE 'No Territory' END as territory_status
FROM tallac_organizations
ORDER BY organization_name
LIMIT 10;

