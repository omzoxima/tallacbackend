import express from 'express';
import { pool } from '../config/database';

const router = express.Router();

// Get dashboard stats
router.get('/stats', async (req, res) => {
  try {
    const { territory } = req.query;
    const params: any[] = [];
    let territoryId: string | null = null;
    
    // Performance optimization: Get territory ID once instead of subquery in each query
    if (territory) {
      const territoryResult = await pool.query(
        'SELECT id FROM tallac_territories WHERE territory_name = $1 LIMIT 1',
        [territory]
      );
      if (territoryResult.rows.length > 0) {
        territoryId = territoryResult.rows[0].id;
        params.push(territoryId);
      }
    }
    
    const territoryFilter = territoryId ? ' AND territory_id = $1' : '';
    
    // Weekly start date
    const weekStart = new Date();
    weekStart.setDate(weekStart.getDate() - 7);
    const weekStartStr = weekStart.toISOString().split('T')[0];
    
    // Run all independent queries in parallel for better performance
    const [
      totalLeadsResult,
      pipelineResult,
      activitiesResult,
      usersResult,
      activityBreakdownResult,
      performanceResult,
      weeklyResult
    ] = await Promise.all([
      // Total leads
      pool.query(`SELECT COUNT(*) as count FROM tallac_leads WHERE 1=1${territoryFilter}`, params),
      
      // Pipeline counts
      pool.query(`SELECT status, COUNT(*) as count FROM tallac_leads WHERE 1=1${territoryFilter} GROUP BY status`, params),
      
      // Total activities
      pool.query('SELECT COUNT(*) as count FROM tallac_activities'),
      
      // Active users
      pool.query('SELECT COUNT(*) as count FROM users WHERE is_active = true'),
      
      // Activity breakdown (queue, scheduled, completed) - single query
      pool.query(`
        SELECT 
          COUNT(*) FILTER (WHERE s.status_name IN ('Open', 'In Progress') AND a.scheduled_date < CURRENT_DATE) as queue,
          COUNT(*) FILTER (WHERE s.status_name IN ('Open', 'In Progress') AND a.scheduled_date >= CURRENT_DATE) as scheduled,
          COUNT(*) FILTER (WHERE s.status_name = 'Completed' AND DATE(a.completed_on) = CURRENT_DATE) as completed_today
        FROM tallac_activities a
        LEFT JOIN activity_statuses s ON a.status_id = s.id
      `),
      
      // Today's performance metrics - optimized single query with FILTER
      pool.query(`
        SELECT 
          COUNT(*) FILTER (WHERE cl.call_date = CURRENT_DATE AND cl.call_type IN ('Outgoing', 'Manual Log')) as calls_today,
          COUNT(*) FILTER (WHERE cl.call_date = CURRENT_DATE - INTERVAL '1 day' AND cl.call_type IN ('Outgoing', 'Manual Log')) as calls_yesterday,
          COUNT(*) FILTER (WHERE a.scheduled_date = CURRENT_DATE AND (a.description ILIKE '%email%' OR a.description ILIKE '%sent%')) as emails_today,
          COUNT(*) FILTER (WHERE a.scheduled_date = CURRENT_DATE - INTERVAL '1 day' AND (a.description ILIKE '%email%' OR a.description ILIKE '%sent%')) as emails_yesterday,
          COUNT(*) FILTER (WHERE a.activity_type = 'Appointment' AND a.scheduled_date = CURRENT_DATE) as appointments_today,
          COUNT(*) FILTER (WHERE a.activity_type = 'Appointment' AND a.scheduled_date = CURRENT_DATE - INTERVAL '1 day') as appointments_yesterday,
          COUNT(*) FILTER (WHERE l.status IN ('Closed Won', 'Won') AND DATE(l.updated_at) = CURRENT_DATE) as deals_today,
          COUNT(*) FILTER (WHERE l.status IN ('Closed Won', 'Won') AND DATE(l.updated_at) = CURRENT_DATE - INTERVAL '1 day') as deals_yesterday
        FROM tallac_call_logs cl
        FULL OUTER JOIN tallac_activities a ON FALSE
        FULL OUTER JOIN tallac_leads l ON FALSE
      `),
      
      // Weekly performance - optimized single query with FILTER
      pool.query(`
        SELECT 
          COUNT(*) FILTER (WHERE DATE(created_at) >= $1) as new_prospects,
          (SELECT COUNT(*) FROM tallac_activities WHERE scheduled_date >= $1) as total_activities,
          COUNT(*) FILTER (WHERE status IN ('Contacted', 'Interested', 'Proposal', 'Closed Won') AND DATE(updated_at) >= $1) as contacted_week,
          COUNT(*) FILTER (WHERE status IN ('Closed Won', 'Won') AND DATE(updated_at) >= $1) as won_deals_week
        FROM tallac_leads
        WHERE 1=1
      `, [weekStartStr])
    ]);
    
    const totalLeads = parseInt(totalLeadsResult.rows[0].count);
    
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
    
    const totalActivities = parseInt(activitiesResult.rows[0].count);
    const activeUsers = parseInt(usersResult.rows[0].count);
    const conversionRate = totalLeads > 0 
      ? Math.round((pipeline.won / totalLeads) * 100) 
      : 0;
    
    const breakdown = activityBreakdownResult.rows[0];
    const queue = parseInt(breakdown.queue || 0);
    const scheduled = parseInt(breakdown.scheduled || 0);
    const completedToday = parseInt(breakdown.completed_today || 0);
    
    const perf = performanceResult.rows[0];
    const callsMade = parseInt(perf.calls_today || 0);
    const callsYesterday = parseInt(perf.calls_yesterday || 0);
    const callsChange = callsYesterday > 0 
      ? Math.round(((callsMade - callsYesterday) / callsYesterday) * 100)
      : (callsMade > 0 ? 100 : 0);
    
    const emailsSent = parseInt(perf.emails_today || 0);
    const emailsYesterday = parseInt(perf.emails_yesterday || 0);
    const emailsChange = emailsYesterday > 0
      ? Math.round(((emailsSent - emailsYesterday) / emailsYesterday) * 100)
      : (emailsSent > 0 ? 100 : 0);
    
    const appointments = parseInt(perf.appointments_today || 0);
    const appointmentsYesterday = parseInt(perf.appointments_yesterday || 0);
    const appointmentsChange = appointmentsYesterday > 0
      ? Math.round(((appointments - appointmentsYesterday) / appointmentsYesterday) * 100)
      : (appointments > 0 ? 100 : 0);
    
    const dealsClosed = parseInt(perf.deals_today || 0);
    const dealsYesterday = parseInt(perf.deals_yesterday || 0);
    const dealsChange = dealsYesterday > 0
      ? Math.round(((dealsClosed - dealsYesterday) / dealsYesterday) * 100)
      : (dealsClosed > 0 ? 100 : 0);
    
    const weekly = weeklyResult.rows[0];
    const newProspects = parseInt(weekly.new_prospects || 0);
    const totalActivitiesWeek = parseInt(weekly.total_activities || 0);
    const contactedWeek = parseInt(weekly.contacted_week || 0);
    const responseRate = totalLeads > 0
      ? Math.round((contactedWeek / totalLeads) * 100)
      : 0;
    
    const wonDealsWeek = parseInt(weekly.won_deals_week || 0);
    const revenue = wonDealsWeek * 50000; // $50k average per deal (adjust based on your data)
    
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
      performance: {
        callsMade,
        callsChange,
        emailsSent,
        emailsChange,
        appointments,
        appointmentsChange,
        dealsClosed,
        dealsChange,
      },
      weeklyPerformance: {
        newProspects,
        totalActivities: totalActivitiesWeek,
        responseRate,
        revenue,
      },
    });
  } catch (error) {
    console.error('Error fetching dashboard stats:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;

