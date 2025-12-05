-- Add sample contacts for organizations

-- Get organization IDs
DO $$
DECLARE
  last_mile_id UUID;
  health_plan_id UUID;
  abc_logistics_id UUID;
  northern_truck_id UUID;
  pacific_warehouse_id UUID;
BEGIN
  -- Get organization IDs
  SELECT id INTO last_mile_id FROM tallac_organizations WHERE organization_name = 'Last Mile Express Delivery';
  SELECT id INTO health_plan_id FROM tallac_organizations WHERE organization_name = 'Health Plan of San Joaquin';
  SELECT id INTO abc_logistics_id FROM tallac_organizations WHERE organization_name = 'ABC Logistics Inc';
  SELECT id INTO northern_truck_id FROM tallac_organizations WHERE organization_name = 'Northern Trucking Company';
  SELECT id INTO pacific_warehouse_id FROM tallac_organizations WHERE organization_name = 'Pacific Warehousing Solutions';

  -- Last Mile Express - 5 contacts
  IF last_mile_id IS NOT NULL THEN
    INSERT INTO tallac_contacts (full_name, first_name, last_name, job_title, email, phone, mobile, organization_id) VALUES
    ('John Smith', 'John', 'Smith', 'CEO', 'john.smith@lastmileexpress.com', '+1-415-555-0701', '+1-415-555-0701', last_mile_id),
    ('Sarah Johnson', 'Sarah', 'Johnson', 'Operations Manager', 'sarah.j@lastmileexpress.com', '+1-415-555-0702', '+1-415-555-0702', last_mile_id),
    ('Michael Brown', 'Michael', 'Brown', 'Sales Director', 'michael.b@lastmileexpress.com', '+1-415-555-0703', '+1-415-555-0703', last_mile_id),
    ('Emily Davis', 'Emily', 'Davis', 'Fleet Manager', 'emily.d@lastmileexpress.com', '+1-415-555-0704', '+1-415-555-0704', last_mile_id),
    ('Robert Wilson', 'Robert', 'Wilson', 'Customer Service Manager', 'robert.w@lastmileexpress.com', '+1-415-555-0705', '+1-415-555-0705', last_mile_id);
    
    RAISE NOTICE '✅ Added 5 contacts for Last Mile Express';
  END IF;

  -- Health Plan of San Joaquin - 3 contacts
  IF health_plan_id IS NOT NULL THEN
    INSERT INTO tallac_contacts (full_name, first_name, last_name, job_title, email, phone, mobile, organization_id) VALUES
    ('Dr. Lisa Martinez', 'Lisa', 'Martinez', 'Chief Medical Officer', 'lisa.martinez@hpsj.com', '+1-209-942-6301', '+1-209-942-6301', health_plan_id),
    ('James Anderson', 'James', 'Anderson', 'Director of Operations', 'james.anderson@hpsj.com', '+1-209-942-6302', '+1-209-942-6302', health_plan_id),
    ('Patricia Taylor', 'Patricia', 'Taylor', 'Member Services Manager', 'patricia.taylor@hpsj.com', '+1-209-942-6303', '+1-209-942-6303', health_plan_id);
    
    RAISE NOTICE '✅ Added 3 contacts for Health Plan';
  END IF;

  -- ABC Logistics - 4 contacts
  IF abc_logistics_id IS NOT NULL THEN
    INSERT INTO tallac_contacts (full_name, first_name, last_name, job_title, email, phone, mobile, organization_id) VALUES
    ('David Chen', 'David', 'Chen', 'President', 'david.chen@abclogistics.com', '+1-213-555-0101', '+1-213-555-0101', abc_logistics_id),
    ('Maria Garcia', 'Maria', 'Garcia', 'VP of Operations', 'maria.garcia@abclogistics.com', '+1-213-555-0102', '+1-213-555-0102', abc_logistics_id),
    ('Thomas Lee', 'Thomas', 'Lee', 'Warehouse Manager', 'thomas.lee@abclogistics.com', '+1-213-555-0103', '+1-213-555-0103', abc_logistics_id),
    ('Jennifer White', 'Jennifer', 'White', 'Account Manager', 'jennifer.white@abclogistics.com', '+1-213-555-0104', '+1-213-555-0104', abc_logistics_id);
    
    RAISE NOTICE '✅ Added 4 contacts for ABC Logistics';
  END IF;

  -- Northern Trucking - 3 contacts
  IF northern_truck_id IS NOT NULL THEN
    INSERT INTO tallac_contacts (full_name, first_name, last_name, job_title, email, phone, mobile, organization_id) VALUES
    ('William Harris', 'William', 'Harris', 'General Manager', 'william.harris@northerntrucking.com', '+1-916-555-0201', '+1-916-555-0201', northern_truck_id),
    ('Linda Clark', 'Linda', 'Clark', 'Dispatch Manager', 'linda.clark@northerntrucking.com', '+1-916-555-0202', '+1-916-555-0202', northern_truck_id),
    ('Richard Lewis', 'Richard', 'Lewis', 'Safety Director', 'richard.lewis@northerntrucking.com', '+1-916-555-0203', '+1-916-555-0203', northern_truck_id);
    
    RAISE NOTICE '✅ Added 3 contacts for Northern Trucking';
  END IF;

  -- Pacific Warehousing - 2 contacts
  IF pacific_warehouse_id IS NOT NULL THEN
    INSERT INTO tallac_contacts (full_name, first_name, last_name, job_title, email, phone, mobile, organization_id) VALUES
    ('Barbara Moore', 'Barbara', 'Moore', 'Facility Manager', 'barbara.moore@pacificwarehouse.com', '+1-206-555-0501', '+1-206-555-0501', pacific_warehouse_id),
    ('Christopher Young', 'Christopher', 'Young', 'Logistics Coordinator', 'christopher.young@pacificwarehouse.com', '+1-206-555-0502', '+1-206-555-0502', pacific_warehouse_id);
    
    RAISE NOTICE '✅ Added 2 contacts for Pacific Warehousing';
  END IF;

  -- Link contacts to organizations in junction table
  INSERT INTO tallac_organization_contacts (organization_id, contact_id, is_primary, sequence)
  SELECT 
    c.organization_id,
    c.id,
    ROW_NUMBER() OVER (PARTITION BY c.organization_id ORDER BY c.created_at) = 1 as is_primary,
    ROW_NUMBER() OVER (PARTITION BY c.organization_id ORDER BY c.created_at) as sequence
  FROM tallac_contacts c
  WHERE c.organization_id IS NOT NULL
  ON CONFLICT (organization_id, contact_id) DO NOTHING;

  RAISE NOTICE '✅ Contacts linked to organizations';

END $$;

-- Show summary
SELECT 
  o.organization_name,
  COUNT(c.id) as contact_count
FROM tallac_organizations o
LEFT JOIN tallac_contacts c ON o.id = c.organization_id
GROUP BY o.id, o.organization_name
HAVING COUNT(c.id) > 0
ORDER BY COUNT(c.id) DESC, o.organization_name;

