import express from 'express';
import { pool } from '../config/database';

const router = express.Router();

// Get dashboard stats
router.get('/stats', async (req, res) => {
  try {
    const { territory } = req.query;
    
    // Total leads
    let totalLeadsQuery = 'SELECT COUNT(*) as count FROM tallac_leads WHERE 1=1';
    const params: any[] = [];
    
    if (territory) {
      totalLeadsQuery += ' AND territory_id = (SELECT id FROM tallac_territories WHERE territory_name = $1)';
      params.push(territory);
    }
    
    const totalLeadsResult = await pool.query(totalLeadsQuery, params);
    const totalLeads = parseInt(totalLeadsResult.rows[0].count);
    
    // Active leads (not closed)
    let activeLeadsQuery = `
      SELECT COUNT(*) as count FROM tallac_leads 
      WHERE status NOT IN ('Closed Won', 'Closed Lost', 'Do Not Call')
    `;
    if (territory) {
      activeLeadsQuery += ' AND territory_id = (SELECT id FROM tallac_territories WHERE territory_name = $1)';
    }
    const activeLeadsResult = await pool.query(activeLeadsQuery, territory ? params : []);
    const activeLeads = parseInt(activeLeadsResult.rows[0].count);
    
    // Pipeline counts
    let pipelineQuery = `
      SELECT status, COUNT(*) as count
      FROM tallac_leads
      WHERE 1=1
    `;
    if (territory) {
      pipelineQuery += ' AND territory_id = (SELECT id FROM tallac_territories WHERE territory_name = $1)';
    }
    pipelineQuery += ' GROUP BY status';
    
    const pipelineResult = await pool.query(pipelineQuery, territory ? params : []);
    const pipeline = {
      new: 0,
      contacted: 0,
      interested: 0,
      proposal: 0,
      won: 0,
      lost: 0,
    };
    
    pipelineResult.rows.forEach((row: any) => {
      const status = row.status.toLowerCase();
      if (status === 'new') pipeline.new = parseInt(row.count);
      else if (status === 'contacted') pipeline.contacted = parseInt(row.count);
      else if (status === 'interested') pipeline.interested = parseInt(row.count);
      else if (status === 'proposal') pipeline.proposal = parseInt(row.count);
      else if (status === 'closed won' || status === 'won') pipeline.won = parseInt(row.count);
      else if (status === 'closed lost' || status === 'lost') pipeline.lost = parseInt(row.count);
    });
    
    // Total activities
    const activitiesResult = await pool.query('SELECT COUNT(*) as count FROM tallac_activities');
    const totalActivities = parseInt(activitiesResult.rows[0].count);
    
    // Active users
    const usersResult = await pool.query('SELECT COUNT(*) as count FROM users WHERE is_active = true');
    const activeUsers = parseInt(usersResult.rows[0].count);
    
    // Conversion rate
    const conversionRate = totalLeads > 0 
      ? Math.round((pipeline.won / totalLeads) * 100) 
      : 0;
    
    // Activity breakdown
    const queueResult = await pool.query(`
      SELECT COUNT(*) as count FROM tallac_activities a
      LEFT JOIN activity_statuses s ON a.status_id = s.id
      WHERE s.status_name IN ('Open', 'In Progress')
      AND a.scheduled_date < CURRENT_DATE
    `);
    const queue = parseInt(queueResult.rows[0].count);
    
    const scheduledResult = await pool.query(`
      SELECT COUNT(*) as count FROM tallac_activities a
      LEFT JOIN activity_statuses s ON a.status_id = s.id
      WHERE s.status_name IN ('Open', 'In Progress')
      AND a.scheduled_date >= CURRENT_DATE
    `);
    const scheduled = parseInt(scheduledResult.rows[0].count);
    
    const completedTodayResult = await pool.query(`
      SELECT COUNT(*) as count FROM tallac_activities a
      LEFT JOIN activity_statuses s ON a.status_id = s.id
      WHERE s.status_name = 'Completed'
      AND DATE(a.completed_on) = CURRENT_DATE
    `);
    const completedToday = parseInt(completedTodayResult.rows[0].count);
    
    res.json({
      kpis: {
        totalProspects: totalLeads,
        totalActivities,
        conversionRate,
        activeUsers,
      },
      pipeline,
      activityBreakdown: {
        queue,
        scheduled,
        completedToday,
      },
    });
  } catch (error) {
    console.error('Error fetching dashboard stats:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;

