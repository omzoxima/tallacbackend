import express from 'express';
import pool from '../config/database.js';
import { authenticateToken } from '../middleware/auth.js';

const router = express.Router();

// Get dashboard analytics
router.get('/analytics', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const userRole = req.user.tallac_role;

    // Get user's territories for filtering
    let territoryFilter = '';
    const territoryParams = [];

    if (!['Corporate Admin', 'System Manager', 'Administrator'].includes(userRole)) {
      const territoriesResult = await pool.query(
        `SELECT territory_id FROM assigned_territories 
         WHERE tallac_user_id = (SELECT id FROM tallac_users WHERE user_id = $1)`,
        [userId]
      );

      const userTerritories = territoriesResult.rows.map(t => t.territory_id);

      if (userTerritories.length > 0) {
        territoryFilter = `AND to_org.territory_id = ANY($${territoryParams.length + 1})`;
        territoryParams.push(userTerritories);
      } else {
        // No territories, show only assigned to user
        territoryFilter = `AND tp.assigned_to_id = $${territoryParams.length + 1}`;
        territoryParams.push(userId);
      }
    }

    // Total Prospects
    const totalProspectsResult = await pool.query(
      `SELECT COUNT(*) as count
       FROM tallac_prospects tp
       JOIN tallac_organizations to_org ON tp.organization_id = to_org.id
       WHERE 1=1 ${territoryFilter}`,
      territoryParams
    );
    const totalProspects = parseInt(totalProspectsResult.rows[0].count);

    // Prospects by Status
    const statusCountsResult = await pool.query(
      `SELECT tp.status, COUNT(*) as count
       FROM tallac_prospects tp
       JOIN tallac_organizations to_org ON tp.organization_id = to_org.id
       WHERE 1=1 ${territoryFilter}
       GROUP BY tp.status`,
      territoryParams
    );

    const statusCounts = {};
    for (const row of statusCountsResult.rows) {
      statusCounts[row.status] = parseInt(row.count);
    }

    // Total Activities
    const totalActivitiesResult = await pool.query(
      `SELECT COUNT(*) as count
       FROM tallac_activities ta
       WHERE ta.assigned_to_id = $1`,
      [userId]
    );
    const totalActivities = parseInt(totalActivitiesResult.rows[0].count);

    // Activities by Type
    const activityTypeCountsResult = await pool.query(
      `SELECT activity_type, COUNT(*) as count
       FROM tallac_activities
       WHERE assigned_to_id = $1
       GROUP BY activity_type`,
      [userId]
    );

    const activityTypeCounts = {};
    for (const row of activityTypeCountsResult.rows) {
      activityTypeCounts[row.activity_type] = parseInt(row.count);
    }

    // Upcoming Activities
    const upcomingActivitiesResult = await pool.query(
      `SELECT COUNT(*) as count
       FROM tallac_activities ta
       JOIN activity_statuses ast ON ta.status_id = ast.id
       WHERE ta.assigned_to_id = $1
         AND ast.status_name IN ('Open', 'In Progress')
         AND ta.scheduled_date >= CURRENT_DATE`,
      [userId]
    );
    const upcomingActivities = parseInt(upcomingActivitiesResult.rows[0].count);

    // Overdue Activities
    const overdueActivitiesResult = await pool.query(
      `SELECT COUNT(*) as count
       FROM tallac_activities ta
       JOIN activity_statuses ast ON ta.status_id = ast.id
       WHERE ta.assigned_to_id = $1
         AND ast.status_name IN ('Open', 'In Progress')
         AND ta.scheduled_date < CURRENT_DATE`,
      [userId]
    );
    const overdueActivities = parseInt(overdueActivitiesResult.rows[0].count);

    // Recent Prospects
    const recentProspectsResult = await pool.query(
      `SELECT tp.id, tp.prospect_code, tp.status, to_org.organization_name, tp.created_at
       FROM tallac_prospects tp
       JOIN tallac_organizations to_org ON tp.organization_id = to_org.id
       WHERE 1=1 ${territoryFilter}
       ORDER BY tp.created_at DESC
       LIMIT 10`,
      territoryParams
    );

    // Map status counts to pipeline format (case-insensitive)
    const pipeline = {
      new: (statusCounts['New'] || 0) + (statusCounts['new'] || 0),
      contacted: (statusCounts['Contacted'] || 0) + (statusCounts['contacted'] || 0),
      interested: (statusCounts['Interested'] || 0) + (statusCounts['interested'] || 0),
      proposal: (statusCounts['Proposal'] || 0) + (statusCounts['proposal'] || 0),
      won: (statusCounts['Closed Won'] || 0) + (statusCounts['Won'] || 0) + (statusCounts['won'] || 0),
      lost: (statusCounts['Closed Lost'] || 0) + (statusCounts['Lost'] || 0) + (statusCounts['lost'] || 0),
    };

    // Calculate conversion rate
    const conversionRate = totalProspects > 0 
      ? Math.round((pipeline.won / totalProspects) * 100) 
      : 0;

    // Activity breakdown
    const activityBreakdown = {
      queue: overdueActivities, // Overdue activities are in queue
      scheduled: upcomingActivities, // Upcoming activities are scheduled
      completedToday: 0, // Will be calculated separately if needed
    };

    // Performance metrics (simplified - can be enhanced later)
    const performance = {
      callsMade: activityTypeCounts['Call Log'] || activityTypeCounts['call-log'] || 0,
      callsChange: 0, // Can be calculated from historical data
      emailsSent: activityTypeCounts['Email'] || activityTypeCounts['email'] || 0,
      emailsChange: 0,
      appointments: activityTypeCounts['Appointment'] || activityTypeCounts['appointment'] || 0,
      appointmentsChange: 0,
      dealsClosed: pipeline.won,
      dealsChange: 0,
    };

    // Weekly performance (simplified - can be enhanced later)
    const weeklyPerformance = {
      newProspects: pipeline.new,
      totalActivities: totalActivities,
      responseRate: totalProspects > 0 ? Math.round((pipeline.contacted / totalProspects) * 100) : 0,
      revenue: 0, // Can be calculated from deals if revenue data is available
    };

    // Get active users count
    const activeUsersResult = await pool.query(
      `SELECT COUNT(DISTINCT tu.id) as count
       FROM tallac_users tu
       JOIN users u ON tu.user_id = u.id
       WHERE COALESCE(u."is_active", u.active, true) = true
         AND tu.status = 'Active'`
    );
    const activeUsers = parseInt(activeUsersResult.rows[0].count);

    res.json({
      success: true,
      data: {
        totalProspects,
        totalActivities,
        conversionRate,
        activeUsers,
        pipeline,
        activityBreakdown,
        performance,
        weeklyPerformance,
        recentProspects: recentProspectsResult.rows
      }
    });
  } catch (error) {
    console.error('Get dashboard analytics error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch analytics', error: error.message });
  }
});

export default router;

