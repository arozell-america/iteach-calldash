import React, { useState, useEffect } from 'react';
import { LineChart, Line, BarChart, Bar, PieChart, Pie, ScatterChart, Scatter, Cell, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, ReferenceLine } from 'recharts';
import { TrendingUp, Users, GraduationCap, MapPin, Calendar, RefreshCw, Award, Clock } from 'lucide-react';
import { ButterflyLoader } from './ButterflyLoader';
import './Dashboard.css';

const EnrollmentDashboard = () => {
  const [rawData, setRawData] = useState([]);
  const [forecastData, setForecastData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [lastUpdate, setLastUpdate] = useState(new Date());
  const [metrics, setMetrics] = useState(null);
  const [selectedState, setSelectedState] = useState('All States');
  const [accessCode, setAccessCode] = useState('');
  const [accessGranted, setAccessGranted] = useState(false);
  const [accessError, setAccessError] = useState(false);
  const [aiNarrative, setAiNarrative] = useState(null);
  const [narrativeLoading, setNarrativeLoading] = useState(true);

  const SALESFORCE_URL = '/.netlify/functions/salesforce-data';
  const SHEET_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vTX4HLDANd_0wzMqs3FN_Xs1IfPWtqmhd2ID7fWMubK8sE22cQaNlDKW73O-q9aB4rg41toPCKYjemg/pub?gid=0&single=true&output=csv';
  const FORECAST_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vTvDX8QKsNlVvn9LhXdaUqiUeEuuXYe1-DA_BsJS-d2wHYnC0UpC1EqEDpeOX6-Ai_r62Nir9YS3Jnb/pub?gid=0&single=true&output=csv';

  const parseCSV = (csv) => {
    const lines = csv.trim().split('\n');
    const headers = lines[0].split(',').map(h => h.trim().replace(/^["']|["']$/g, '')); // Remove quotes and trim
    
    return lines.slice(1).map(line => {
      const values = line.split(',').map(v => v.trim().replace(/^["']|["']$/g, ''));
      const obj = {};
      headers.forEach((header, index) => {
        obj[header] = values[index] || '';
      });
      return obj;
    });
  };

  const calculateMetrics = (rawData, stateFilter = 'All States', forecastData = []) => {
    const now = new Date(); // Declare now at the top so all sections can use it
    
    // Filter data by selected state
    const filteredData = stateFilter === 'All States' 
      ? rawData 
      : rawData.filter(r => r['Certification state'] === stateFilter);
    
    const totalApplications = filteredData.length;
    const enrolled = filteredData.filter(r => r.Enrolled).length;
    const dateEntered = filteredData.filter(r => r['Date Entered']).length;
    const dropped = filteredData.filter(r => r['Dropped Date']).length;
    
    // Enrollment Rate - LAST 6 MONTHS ONLY
    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
    const last6MonthsApps = filteredData.filter(r => r.Applied && new Date(r.Applied) >= sixMonthsAgo);
    const last6MonthsEnrolled = last6MonthsApps.filter(r => r.Enrolled).length;
    const enrollmentRate = last6MonthsApps.length > 0 ? ((last6MonthsEnrolled / last6MonthsApps.length) * 100).toFixed(1) : '0.0';
    
    // Completion Rate - LAST 2 YEARS ONLY
    const twoYearsAgo = new Date();
    twoYearsAgo.setFullYear(twoYearsAgo.getFullYear() - 2);
    const last2YearsEnrolled = filteredData.filter(r => r.Enrolled && new Date(r.Enrolled) >= twoYearsAgo);
    const last2YearsCompleted = last2YearsEnrolled.filter(r => r['Date Entered']).length;
    const completionRate = last2YearsEnrolled.length > 0 ? ((last2YearsCompleted / last2YearsEnrolled.length) * 100).toFixed(1) : '0.0';
    
    const retentionRate = (((dateEntered - dropped) / dateEntered) * 100).toFixed(1);

    const stateBreakdown = filteredData.reduce((acc, row) => {
      const state = row['Certification state'] || 'Unknown';
      acc[state] = (acc[state] || 0) + 1;
      return acc;
    }, {});

    const semesterBreakdown = filteredData.reduce((acc, row) => {
      const semester = row['FE Semester'] || 'Not Started';
      if (semester) {
        acc[semester] = (acc[semester] || 0) + 1;
      }
      return acc;
    }, {});

    const enrollmentTimes = rawData
      .filter(r => r.Applied && r.Enrolled)
      .map(r => {
        const applied = new Date(r.Applied);
        const enrolled = new Date(r.Enrolled);
        return Math.floor((enrolled - applied) / (1000 * 60 * 60 * 24));
      });
    
    const avgEnrollmentTime = enrollmentTimes.length > 0
      ? Math.round(enrollmentTimes.reduce((a, b) => a + b, 0) / enrollmentTimes.length)
      : 0;

    // Most Popular Application Time (last 6 months)
    const sixMonthsAgo = new Date(now);
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
    
    // Try different possible column names for the time field
    const timeColumnNames = ['Created Time', 'Application Time', 'Time Applied', 'Applied Time', 'Time', 'Application Timestamp'];
    const timeColumn = timeColumnNames.find(col => filteredData.some(r => r[col]));
    
    const timeOfDayBreakdown = { 'Morning (6am-12pm)': 0, 'Afternoon (12pm-6pm)': 0, 'Evening (6pm-12am)': 0, 'Night (12am-6am)': 0 };
    
    if (timeColumn) {
      console.log(`Found time column: ${timeColumn}`);
      
      const recentApps = filteredData
        .filter(r => {
          if (!r.Applied || !r[timeColumn]) return false;
          const appliedDate = new Date(r.Applied);
          return appliedDate >= sixMonthsAgo;
        });
      
      console.log(`Processing ${recentApps.length} applications from last 6 months`);
      
      recentApps.forEach((r, index) => {
          const timeStr = r[timeColumn];
          
          // Log first few entries to see format
          if (index < 3) {
            console.log(`Sample time data: "${timeStr}"`);
          }
          
          // Parse time - handle formats like "14:30", "2:30 PM", "14:30:00"
          let hour = 0;
          
          if (timeStr && timeStr.includes(':')) {
            const parts = timeStr.split(':');
            hour = parseInt(parts[0]);
            
            // Handle 12-hour format with AM/PM
            if (timeStr.toLowerCase().includes('pm') && hour !== 12) {
              hour += 12;
            } else if (timeStr.toLowerCase().includes('am') && hour === 12) {
              hour = 0;
            }
          }
          
          // Categorize by time of day
          if (hour >= 6 && hour < 12) {
            timeOfDayBreakdown['Morning (6am-12pm)']++;
          } else if (hour >= 12 && hour < 18) {
            timeOfDayBreakdown['Afternoon (12pm-6pm)']++;
          } else if (hour >= 18 && hour < 24) {
            timeOfDayBreakdown['Evening (6pm-12am)']++;
          } else {
            timeOfDayBreakdown['Night (12am-6am)']++;
          }
        });
      
      console.log('Time breakdown:', timeOfDayBreakdown);
    } else {
      console.log('No time column found in data');
    }
    
    // Find the most popular time slot
    const mostPopularTime = Object.entries(timeOfDayBreakdown)
      .sort((a, b) => b[1] - a[1])[0];
    
    const popularTimeSlot = mostPopularTime ? mostPopularTime[0] : 'N/A';
    const popularTimeCount = mostPopularTime ? mostPopularTime[1] : 0;

    const semesterTrends = Object.entries(semesterBreakdown)
      .filter(([sem]) => sem !== 'Not Started')
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([semester, count]) => ({
        semester: semester.replace(' (Transitional)', '*'),
        students: count,
        enrolled: filteredData.filter(r => r['FE Semester'] === semester && r.Enrolled).length
      }));

    // Semester Year-over-Year Growth (Fall to Fall, Spring to Spring)
    const semesterYoY = {};
    filteredData.forEach(r => {
      const semester = r['FE Semester'];
      if (!semester || semester === 'Not Started') return;
      
      // Extract term and year (e.g., "Fall 2024" -> "Fall", "2024")
      const match = semester.match(/(Fall|Spring)\s*(\d{4})/i);
      if (match) {
        const term = match[1];
        const year = parseInt(match[2]);
        
        // Only include Fall and Spring from 2018 onwards
        if (year < 2018) return;
        
        const key = term;
        
        if (!semesterYoY[key]) semesterYoY[key] = {};
        if (!semesterYoY[key][year]) semesterYoY[key][year] = 0;
        
        if (r.Enrolled) {
          semesterYoY[key][year]++;
        }
      }
    });
    
    // Convert to chart format: Spring 2018, Fall 2018, Spring 2019, Fall 2019...
    const semesterComparison = [];
    const startYear = 2018;
    const endYear = now.getFullYear();
    
    for (let year = startYear; year <= endYear; year++) {
      // Spring first, then Fall for each year
      if (semesterYoY['Spring'] && semesterYoY['Spring'][year]) {
        semesterComparison.push({
          term: `Spring ${year}`,
          enrolled: semesterYoY['Spring'][year],
          termOnly: 'Spring'
        });
      }
      
      if (semesterYoY['Fall'] && semesterYoY['Fall'][year]) {
        semesterComparison.push({
          term: `Fall ${year}`,
          enrolled: semesterYoY['Fall'][year],
          termOnly: 'Fall'
        });
      }
    }

    const monthlyApps = filteredData.reduce((acc, row) => {
      if (row.Applied) {
        const date = new Date(row.Applied);
        const monthYear = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
        acc[monthYear] = (acc[monthYear] || 0) + 1;
      }
      return acc;
    }, {});

    // Get all 12 calendar months with 3-year comparison
    const currentYearForTrend = now.getFullYear();
    const year1Label = (currentYearForTrend - 2).toString();
    const year2Label = (currentYearForTrend - 1).toString();
    const year3Label = currentYearForTrend.toString();
    
    // Build chart for all 12 calendar months (Jan-Dec)
    const monthlyTrend = [];
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    
    for (let monthIndex = 0; monthIndex < 12; monthIndex++) {
      const monthName = monthNames[monthIndex];
      
      // Get applications for this month in each of the 3 years
      const year1Key = `${currentYearForTrend - 2}-${String(monthIndex + 1).padStart(2, '0')}`;
      const year2Key = `${currentYearForTrend - 1}-${String(monthIndex + 1).padStart(2, '0')}`;
      const year3Key = `${currentYearForTrend}-${String(monthIndex + 1).padStart(2, '0')}`;
      
      const dataPoint = {
        month: monthName,
        [year1Label]: monthlyApps[year1Key] || 0,
        [year2Label]: monthlyApps[year2Key] || 0,
        [year3Label]: monthlyApps[year3Key] || 0
      };
      
      monthlyTrend.push(dataPoint);
    }
    
    const monthlyTrendMeta = { year1Label, year2Label, year3Label };

    const currentSemester = semesterTrends[semesterTrends.length - 1];
    const allSemesterCounts = semesterTrends.map(s => s.students).sort((a, b) => b - a);
    const currentRank = currentSemester 
      ? allSemesterCounts.indexOf(currentSemester.students) + 1
      : null;

    // MTD Calculations (comparing full days only - up to yesterday)
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth();
    const lastYear = currentYear - 1;
    
    // Get yesterday's date at midnight to ensure we're comparing full days
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    yesterday.setHours(23, 59, 59, 999); // End of yesterday
    
    // Get the day of month for yesterday (e.g., if today is Feb 5, we compare up to Feb 4)
    const dayOfMonth = yesterday.getDate();

    // Applications MTD (current month this year, up to same day)
    const applicationsMTD = filteredData.filter(r => {
      if (!r.Applied) return false;
      const date = new Date(r.Applied);
      return date.getFullYear() === currentYear && 
             date.getMonth() === currentMonth &&
             date.getDate() <= dayOfMonth;
    }).length;

    // Applications same period last year (same month, same day range)
    const applicationsLastYearSameMonth = filteredData.filter(r => {
      if (!r.Applied) return false;
      const date = new Date(r.Applied);
      return date.getFullYear() === lastYear && 
             date.getMonth() === currentMonth &&
             date.getDate() <= dayOfMonth;
    }).length;

    // Enrollments MTD (current month this year, up to same day)
    const enrollmentsMTD = filteredData.filter(r => {
      if (!r.Enrolled) return false;
      const date = new Date(r.Enrolled);
      return date.getFullYear() === currentYear && 
             date.getMonth() === currentMonth &&
             date.getDate() <= dayOfMonth;
    }).length;

    // Enrollments same period last year (same month, same day range)
    const enrollmentsLastYearSameMonth = filteredData.filter(r => {
      if (!r.Enrolled) return false;
      const date = new Date(r.Enrolled);
      return date.getFullYear() === lastYear && 
             date.getMonth() === currentMonth &&
             date.getDate() <= dayOfMonth;
    }).length;

    // Calculate YoY growth
    const applicationsYoYGrowth = applicationsLastYearSameMonth > 0
      ? (((applicationsMTD - applicationsLastYearSameMonth) / applicationsLastYearSameMonth) * 100).toFixed(1)
      : 0;

    const enrollmentsYoYGrowth = enrollmentsLastYearSameMonth > 0
      ? (((enrollmentsMTD - enrollmentsLastYearSameMonth) / enrollmentsLastYearSameMonth) * 100).toFixed(1)
      : 0;

    // FORECAST MTD AND YTD CALCULATIONS
    // New simplified structure: Row 1 has "Category" + "State" + dates, Row 2+ has category label + states + data
    let forecastApplicationsMTD = 0;
    let forecastApplicationsMTDFiltered = 0;
    let forecastEnrollmentsMTD = 0;
    let forecastEnrollmentsMTDFiltered = 0;
    
    let forecastApplicationsYTD = 0;
    let forecastApplicationsYTDFiltered = 0;
    let forecastEnrollmentsYTD = 0;
    let forecastEnrollmentsYTDFiltered = 0;
    
    if (forecastData && forecastData.length > 0) {
      console.log('Processing forecast data...');
      console.log('Total forecast rows:', forecastData.length);
      console.log('First 5 rows:', forecastData.slice(0, 5));
      
      // Row 1 should have "Category" in column A, "State" in column B, then dates in columns C, D, E...
      const headerRow = forecastData[0];
      const headerValues = Object.values(headerRow);
      const headerKeys = Object.keys(headerRow);
      
      console.log('Header row values:', headerValues);
      console.log('Header row keys:', headerKeys);
      console.log('Total header columns:', headerKeys.length);
      console.log('First header row object:', headerRow);
      
      // Find MTD date columns for current month
      const mtdColumns = [];
      // Find YTD date columns (Jan 1 through yesterday)
      const ytdColumns = [];
      
      // Log some sample dates from different parts of the header
      console.log('Sample dates from header:');
      console.log('  Columns 0-5:', headerValues.slice(0, 5));
      console.log('  Columns 30-35:', headerValues.slice(30, 35));
      console.log('  Columns 60-65:', headerValues.slice(60, 65));
      
      const startOfYear = new Date(currentYear, 0, 1); // Jan 1 of current year
      
      headerKeys.forEach((colKey, idx) => {
        // colKey IS the date string (e.g., "1/1/2026", "2/1/2026")
        if (typeof colKey === 'string' && /^\d{1,2}\/\d{1,2}\/\d{4}$/.test(colKey.trim())) {
          const parts = colKey.trim().split('/');
          const month = parseInt(parts[0]);
          const day = parseInt(parts[1]);
          const year = parseInt(parts[2]);
          
          // Log first few dates found
          if (mtdColumns.length < 5) {
            console.log(`Column ${idx}: Found date ${colKey} (month=${month}, looking for month=${currentMonth + 1})`);
          }
          
          const dateObj = new Date(year, month - 1, day);
          
          // Check if this is current month and within MTD
          if (year === currentYear && month === currentMonth + 1 && day <= dayOfMonth) {
            mtdColumns.push({ colKey, dateStr: colKey, month, day });
          }
          
          // Check if this is YTD (Jan 1 through yesterday)
          if (year === currentYear && dateObj >= startOfYear && dateObj <= yesterday) {
            ytdColumns.push({ colKey, dateStr: colKey, month, day });
          }
        }
      });
      
      console.log(`Found ${mtdColumns.length} MTD columns:`, mtdColumns.map(c => c.dateStr));
      console.log(`Found ${ytdColumns.length} YTD columns (Jan 1 - yesterday)`);
      
      // Process data rows - look for "Applications" and "Enrollments" sections
      let currentCategory = null;
      let rowsProcessed = { Applications: [], Enrollments: [], Unknown: [] };
      
      for (let i = 0; i < forecastData.length; i++) {
        const row = forecastData[i];
        
        // Get Category from column A and State from column B
        const categoryCol = row['Category'] || '';
        const stateCol = row['State'] || '';
        
        // Log ALL rows to see full structure
        if (i <= 50 || categoryCol) {
          console.log(`Row ${i}: Category="${categoryCol}", State="${stateCol}"`);
        }
        
        // Check if this row is a category header (but still process the row if it has a state)
        if (typeof categoryCol === 'string' && categoryCol.toLowerCase().includes('application')) {
          currentCategory = 'Applications';
          console.log(`>>> SWITCHED TO Applications at row ${i}`);
        } else if (typeof categoryCol === 'string' && categoryCol.toLowerCase().includes('enrollment')) {
          currentCategory = 'Enrollments';
          console.log(`>>> SWITCHED TO Enrollments at row ${i}`);
        } else if (typeof categoryCol === 'string' && categoryCol.toLowerCase().includes('hire')) {
          currentCategory = 'Hires';
          console.log(`>>> SWITCHED TO Hires at row ${i} (not summed into Apps/Enrollments)`);
        }
        
        // Get state name from column B
        const stateName = typeof stateCol === 'string' ? stateCol.trim() : '';
        const stateNameLower = stateName.toLowerCase();
        
        // Skip empty rows, header rows, total/summary rows, and blank-state rows
        // Also skip if the "state" is actually a category label or repeated header
        if (!stateName || stateName === '' || stateName === 'State' || 
            stateNameLower === 'total' || stateNameLower === 'totals' ||
            stateNameLower.includes('grand total') || stateNameLower.includes('sum') ||
            stateNameLower === 'all' || stateNameLower === 'all states' ||
            stateNameLower.includes('application') || stateNameLower.includes('enrollment') ||
            stateNameLower.includes('hire') || stateNameLower === 'category') {
          if (stateName) {
            console.log(`   SKIPPED: State="${stateName}"`);
          }
          continue;
        }
        
        // Check if this state matches the filter
        const includeThisState = stateFilter === 'All States' || 
                                  stateName === stateFilter ||
                                  stateName.toLowerCase() === stateFilter.toLowerCase();
        
        // Sum values from MTD columns and track per-row contribution
        let rowMTDSum = 0;
        mtdColumns.forEach(({ colKey }) => {
          const value = parseFloat(row[colKey]) || 0;
          rowMTDSum += value;
          
          if (currentCategory === 'Applications') {
            forecastApplicationsMTD += value;
            if (includeThisState) {
              forecastApplicationsMTDFiltered += value;
            }
          } else if (currentCategory === 'Enrollments') {
            forecastEnrollmentsMTD += value;
            if (includeThisState) {
              forecastEnrollmentsMTDFiltered += value;
            }
          }
        });
        
        // Log every row's contribution
        const bucket = currentCategory || 'Unknown';
        rowsProcessed[bucket] = rowsProcessed[bucket] || [];
        rowsProcessed[bucket].push({ row: i, state: stateName, mtd: rowMTDSum.toFixed(1) });
        console.log(`   SUMMED row ${i}: ${bucket} / ${stateName} => MTD +${rowMTDSum.toFixed(1)} (running: Apps=${forecastApplicationsMTD.toFixed(1)}, Enroll=${forecastEnrollmentsMTD.toFixed(1)})`);
        
        // Sum values from YTD columns
        ytdColumns.forEach(({ colKey }) => {
          const value = parseFloat(row[colKey]) || 0;
          
          if (currentCategory === 'Applications') {
            forecastApplicationsYTD += value;
            if (includeThisState) {
              forecastApplicationsYTDFiltered += value;
            }
          } else if (currentCategory === 'Enrollments') {
            forecastEnrollmentsYTD += value;
            if (includeThisState) {
              forecastEnrollmentsYTDFiltered += value;
            }
          }
        });
      }
      
      console.log('=== FORECAST SUMMARY ===');
      console.log(`Applications rows processed: ${(rowsProcessed.Applications || []).length}`);
      console.log(`Enrollments rows processed: ${(rowsProcessed.Enrollments || []).length}`);
      console.log(`Unknown rows processed: ${(rowsProcessed.Unknown || []).length}`);
      if ((rowsProcessed.Unknown || []).length > 0) {
        console.log('WARNING: Unknown category rows:', rowsProcessed.Unknown);
      }
      
      console.log(`Forecast Applications MTD (All): ${forecastApplicationsMTD}`);
      console.log(`Forecast Applications MTD (${stateFilter}): ${forecastApplicationsMTDFiltered}`);
      console.log(`Forecast Enrollments MTD (All): ${forecastEnrollmentsMTD}`);
      console.log(`Forecast Enrollments MTD (${stateFilter}): ${forecastEnrollmentsMTDFiltered}`);
      console.log(`Forecast Applications YTD (All): ${forecastApplicationsYTD}`);
      console.log(`Forecast Applications YTD (${stateFilter}): ${forecastApplicationsYTDFiltered}`);
      console.log(`Forecast Enrollments YTD (All): ${forecastEnrollmentsYTD}`);
      console.log(`Forecast Enrollments YTD (${stateFilter}): ${forecastEnrollmentsYTDFiltered}`);
    } else {
      console.log('No forecast data available');
    }

    // YTD Calculations (Jan 1 through yesterday of current year vs same period last year)
    const startOfYear = new Date(currentYear, 0, 1); // January 1 of current year
    
    // Applications YTD (Jan 1 through yesterday this year)
    const applicationsYTD = filteredData.filter(r => {
      if (!r.Applied) return false;
      const date = new Date(r.Applied);
      return date >= startOfYear && date <= yesterday;
    }).length;

    // Applications same period last year (Jan 1 through same day last year)
    const lastYearYesterday = new Date(lastYear, yesterday.getMonth(), yesterday.getDate(), 23, 59, 59, 999);
    const startOfLastYear = new Date(lastYear, 0, 1);
    
    const applicationsLastYearYTD = filteredData.filter(r => {
      if (!r.Applied) return false;
      const date = new Date(r.Applied);
      return date >= startOfLastYear && date <= lastYearYesterday;
    }).length;

    // Enrollments YTD (Jan 1 through yesterday this year)
    const enrollmentsYTD = filteredData.filter(r => {
      if (!r.Enrolled) return false;
      const date = new Date(r.Enrolled);
      return date >= startOfYear && date <= yesterday;
    }).length;

    // Enrollments same period last year (Jan 1 through same day last year)
    const enrollmentsLastYearYTD = filteredData.filter(r => {
      if (!r.Enrolled) return false;
      const date = new Date(r.Enrolled);
      return date >= startOfLastYear && date <= lastYearYesterday;
    }).length;

    // Calculate YTD YoY growth
    const applicationsYTDGrowth = applicationsLastYearYTD > 0
      ? (((applicationsYTD - applicationsLastYearYTD) / applicationsLastYearYTD) * 100).toFixed(1)
      : 0;

    const enrollmentsYTDGrowth = enrollmentsLastYearYTD > 0
      ? (((enrollmentsYTD - enrollmentsLastYearYTD) / enrollmentsLastYearYTD) * 100).toFixed(1)
      : 0;

    // Calculate forecast variances (now that MTD and YTD are defined)
    const forecastAppsToUse = stateFilter === 'All States' ? forecastApplicationsMTD : forecastApplicationsMTDFiltered;
    const forecastAppsVariance = forecastAppsToUse > 0
      ? (((applicationsMTD - forecastAppsToUse) / forecastAppsToUse) * 100).toFixed(1)
      : 0;
      
    const forecastEnrollToUse = stateFilter === 'All States' ? forecastEnrollmentsMTD : forecastEnrollmentsMTDFiltered;
    const forecastEnrollVariance = forecastEnrollToUse > 0
      ? (((enrollmentsMTD - forecastEnrollToUse) / forecastEnrollToUse) * 100).toFixed(1)
      : 0;
      
    const forecastAppsYTDToUse = stateFilter === 'All States' ? forecastApplicationsYTD : forecastApplicationsYTDFiltered;
    const forecastAppsYTDVariance = forecastAppsYTDToUse > 0
      ? (((applicationsYTD - forecastAppsYTDToUse) / forecastAppsYTDToUse) * 100).toFixed(1)
      : 0;
      
    const forecastEnrollYTDToUse = stateFilter === 'All States' ? forecastEnrollmentsYTD : forecastEnrollmentsYTDFiltered;
    const forecastEnrollYTDVariance = forecastEnrollYTDToUse > 0
      ? (((enrollmentsYTD - forecastEnrollYTDToUse) / forecastEnrollYTDToUse) * 100).toFixed(1)
      : 0;

    // Spring Hires Comparison (Spring 2026 vs Spring 2025, comparing same moment in time)
    // Spring 2026: Count hires with Date Entered within last 365 days as of yesterday
    const spring2026Hires = filteredData.filter(r => {
      if (!r['FE Semester'] || !r['Date Entered']) return false;
      const semester = r['FE Semester'];
      const dateEntered = new Date(r['Date Entered']);
      
      // Check if it's Spring 2026 and Date Entered is within 365 days from yesterday
      if (semester.includes('Spring 2026')) {
        const daysSinceEntered = Math.floor((yesterday - dateEntered) / (1000 * 60 * 60 * 24));
        return daysSinceEntered >= 0 && daysSinceEntered < 365;
      }
      return false;
    }).length;

    // Spring 2025: Count hires at same point last year
    // Same day last year
    const sameDayLastYear = new Date(yesterday);
    sameDayLastYear.setFullYear(sameDayLastYear.getFullYear() - 1);
    
    // 365 days before same day last year
    const startDateLastYear = new Date(sameDayLastYear);
    startDateLastYear.setDate(startDateLastYear.getDate() - 365);
    
    const spring2025Hires = filteredData.filter(r => {
      if (!r['FE Semester'] || !r['Date Entered']) return false;
      const semester = r['FE Semester'];
      const dateEntered = new Date(r['Date Entered']);
      
      // Check if it's Spring 2025 and Date Entered was between startDateLastYear and sameDayLastYear
      if (semester.includes('Spring 2025')) {
        return dateEntered >= startDateLastYear && dateEntered <= sameDayLastYear;
      }
      return false;
    }).length;

    const springHiresGrowth = spring2025Hires > 0
      ? (((spring2026Hires - spring2025Hires) / spring2025Hires) * 100).toFixed(1)
      : 0;

    // Fall 2025 Hires: Count hires with Date Entered within last 365 days as of yesterday
    const fall2025Hires = filteredData.filter(r => {
      if (!r['FE Semester'] || !r['Date Entered']) return false;
      const semester = r['FE Semester'];
      const dateEntered = new Date(r['Date Entered']);
      
      // Check if it's Fall 2025 and Date Entered is within 365 days from yesterday
      if (semester.includes('Fall 2025')) {
        const daysSinceEntered = Math.floor((yesterday - dateEntered) / (1000 * 60 * 60 * 24));
        return daysSinceEntered >= 0 && daysSinceEntered < 365;
      }
      return false;
    }).length;

    // Currently Placed Teachers: Fall 2025 + Spring 2026
    const currentlyPlacedTeachers = fall2025Hires + spring2026Hires;
    
    if (stateFilter !== 'All States') {
      console.log(`State Filter: ${stateFilter}`);
      console.log(`Fall 2025 Hires: ${fall2025Hires}`);
      console.log(`Spring 2026 Hires: ${spring2026Hires}`);
      console.log(`Currently Placed Teachers: ${currentlyPlacedTeachers}`);
    }

    // Neat Facts Calculations
    
    // 1. Application Pacing Rank (compare MTD this year vs same period all previous years)
    const allYears = [...new Set(filteredData.map(r => {
      if (!r.Applied) return null;
      return new Date(r.Applied).getFullYear();
    }).filter(y => y !== null))].sort((a, b) => b - a);
    
    const applicationPacings = allYears.map(year => {
      const yearApps = filteredData.filter(r => {
        if (!r.Applied) return false;
        const date = new Date(r.Applied);
        return date.getFullYear() === year && 
               date.getMonth() === currentMonth &&
               date.getDate() <= dayOfMonth;
      }).length;
      return { year, count: yearApps };
    });
    
    const currentYearPacing = applicationPacings.find(p => p.year === currentYear)?.count || 0;
    const sortedAppPacings = [...applicationPacings].sort((a, b) => b.count - a.count);
    const appPacingRank = sortedAppPacings.findIndex(p => p.year === currentYear) + 1;
    
    // 2. Enrollment Pacing Rank (compare MTD this year vs same period all previous years)
    const enrollmentPacings = allYears.map(year => {
      const yearEnrollments = filteredData.filter(r => {
        if (!r.Enrolled) return false;
        const date = new Date(r.Enrolled);
        return date.getFullYear() === year && 
               date.getMonth() === currentMonth &&
               date.getDate() <= dayOfMonth;
      }).length;
      return { year, count: yearEnrollments };
    });
    
    const currentYearEnrollmentPacing = enrollmentPacings.find(p => p.year === currentYear)?.count || 0;
    const sortedEnrollPacings = [...enrollmentPacings].sort((a, b) => b.count - a.count);
    const enrollmentPacingRank = sortedEnrollPacings.findIndex(p => p.year === currentYear) + 1;
    
    // 3. Top Application State MTD
    const mtdApplicationsByState = filteredData.filter(r => {
      if (!r.Applied) return false;
      const date = new Date(r.Applied);
      return date.getFullYear() === currentYear && 
             date.getMonth() === currentMonth &&
             date.getDate() <= dayOfMonth;
    }).reduce((acc, row) => {
      const state = row['Certification state'] || 'Unknown';
      acc[state] = (acc[state] || 0) + 1;
      return acc;
    }, {});
    
    const topStateMTD = Object.entries(mtdApplicationsByState)
      .sort((a, b) => b[1] - a[1])[0];
    
    const topState = topStateMTD ? {
      name: topStateMTD[0],
      count: topStateMTD[1],
      percentage: ((topStateMTD[1] / applicationsMTD) * 100).toFixed(1)
    } : null;

    // NEW METRIC 1: Enrollment-to-Hired Conversion Rate
    const enrolledWithDateEntered = filteredData.filter(r => r.Enrolled && r['Date Entered']).length;
    const enrollmentToHiredRate = enrolled > 0 ? ((enrolledWithDateEntered / enrolled) * 100).toFixed(1) : 0;

    // NEW METRIC 2: State Quality Ranking (Enrollment Rate × Retention Rate)
    const stateQuality = Object.keys(stateBreakdown).map(state => {
      const stateApps = filteredData.filter(r => r['Certification state'] === state);
      const stateEnrolled = stateApps.filter(r => r.Enrolled).length;
      const stateStarted = stateApps.filter(r => r['Date Entered']).length;
      const stateDropped = stateApps.filter(r => r['Dropped Date']).length;
      const stateActive = stateStarted - stateDropped;
      
      const enrollRate = stateApps.length > 0 ? (stateEnrolled / stateApps.length) * 100 : 0;
      const retentionRate = stateStarted > 0 ? (stateActive / stateStarted) * 100 : 0;
      const qualityScore = (enrollRate / 100) * (retentionRate / 100) * 100; // Combined score
      
      return {
        state,
        applications: stateApps.length,
        enrolled: stateEnrolled,
        enrollRate: enrollRate.toFixed(1),
        retentionRate: retentionRate.toFixed(1),
        qualityScore: qualityScore.toFixed(1)
      };
    }).sort((a, b) => parseFloat(b.qualityScore) - parseFloat(a.qualityScore));

    // NEW METRIC 3: Retention by Time Period (cohort analysis)
    const retentionByPeriod = {
      within30: 0,
      within60: 0,
      within90: 0,
      within180: 0,
      over180: 0
    };
    
    const startedCandidates = filteredData.filter(r => r['Date Entered']);
    startedCandidates.forEach(r => {
      const dateEntered = new Date(r['Date Entered']);
      const daysSinceStart = Math.floor((now - dateEntered) / (1000 * 60 * 60 * 24));
      const isActive = !r['Dropped Date'];
      
      if (daysSinceStart <= 30) {
        retentionByPeriod.within30++;
      } else if (daysSinceStart <= 60 && isActive) {
        retentionByPeriod.within60++;
      } else if (daysSinceStart <= 90 && isActive) {
        retentionByPeriod.within90++;
      } else if (daysSinceStart <= 180 && isActive) {
        retentionByPeriod.within180++;
      } else if (isActive) {
        retentionByPeriod.over180++;
      }
    });
    
    const totalStarted = startedCandidates.length;
    const retentionRates = {
      within30: totalStarted > 0 ? ((retentionByPeriod.within30 / totalStarted) * 100).toFixed(1) : 0,
      within60: totalStarted > 0 ? ((retentionByPeriod.within60 / totalStarted) * 100).toFixed(1) : 0,
      within90: totalStarted > 0 ? ((retentionByPeriod.within90 / totalStarted) * 100).toFixed(1) : 0,
      within180: totalStarted > 0 ? ((retentionByPeriod.within180 / totalStarted) * 100).toFixed(1) : 0,
      over180: totalStarted > 0 ? ((retentionByPeriod.over180 / totalStarted) * 100).toFixed(1) : 0
    };

    // Cohort Conversion Analysis - Last 9 months of applications
    const cohortAnalysis = [];
    for (let i = 8; i >= 0; i--) {
      const monthDate = new Date(now);
      monthDate.setMonth(monthDate.getMonth() - i);
      const year = monthDate.getFullYear();
      const month = monthDate.getMonth();
      
      // Get all applications from this month
      const monthApplications = filteredData.filter(r => {
        if (!r.Applied) return false;
        const appliedDate = new Date(r.Applied);
        return appliedDate.getFullYear() === year && appliedDate.getMonth() === month;
      });
      
      const totalApps = monthApplications.length;
      
      // Calculate conversions within different time windows
      const conversions = {
        within30: 0,
        within60: 0,
        within90: 0,
        within180: 0,
        over180: 0,
        notConverted: 0
      };
      
      monthApplications.forEach(app => {
        if (!app.Enrolled) {
          conversions.notConverted++;
          return;
        }
        
        const appliedDate = new Date(app.Applied);
        const enrolledDate = new Date(app.Enrolled);
        const days = Math.floor((enrolledDate - appliedDate) / (1000 * 60 * 60 * 24));
        
        if (days <= 30) conversions.within30++;
        else if (days <= 60) conversions.within60++;
        else if (days <= 90) conversions.within90++;
        else if (days <= 180) conversions.within180++;
        else conversions.over180++;
      });
      
      cohortAnalysis.push({
        month: monthDate.toLocaleDateString('en-US', { month: 'short', year: 'numeric' }),
        totalApps,
        within30: totalApps > 0 ? ((conversions.within30 / totalApps) * 100).toFixed(1) : 0,
        within60: totalApps > 0 ? ((conversions.within60 / totalApps) * 100).toFixed(1) : 0,
        within90: totalApps > 0 ? ((conversions.within90 / totalApps) * 100).toFixed(1) : 0,
        within180: totalApps > 0 ? ((conversions.within180 / totalApps) * 100).toFixed(1) : 0,
        over180: totalApps > 0 ? ((conversions.over180 / totalApps) * 100).toFixed(1) : 0,
        notConverted: totalApps > 0 ? ((conversions.notConverted / totalApps) * 100).toFixed(1) : 0,
        conversions: conversions
      });
    }

    // Overall conversion distribution (last year only)
    const oneYearAgo = new Date(now);
    oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
    
    const allConversions = filteredData.filter(r => {
      if (!r.Applied || !r.Enrolled) return false;
      const enrolledDate = new Date(r.Enrolled);
      return enrolledDate >= oneYearAgo;
    });
    
    const conversionDistribution = {
      within30: 0,
      within60: 0,
      within90: 0,
      within180: 0,
      over180: 0
    };
    
    allConversions.forEach(app => {
      const appliedDate = new Date(app.Applied);
      const enrolledDate = new Date(app.Enrolled);
      const days = Math.floor((enrolledDate - appliedDate) / (1000 * 60 * 60 * 24));
      
      if (days <= 30) conversionDistribution.within30++;
      else if (days <= 60) conversionDistribution.within60++;
      else if (days <= 90) conversionDistribution.within90++;
      else if (days <= 180) conversionDistribution.within180++;
      else conversionDistribution.over180++;
    });

    // State Performance Scores (Last 6 Months)
    // Calculate for each state: conversion rate, velocity, and overall score
    const sixMonthsCutoff = new Date(yesterday);
    sixMonthsCutoff.setMonth(sixMonthsCutoff.getMonth() - 6);
    
    const stateScores = [];
    const stateNames = [...new Set(filteredData.map(r => r['Certification state']).filter(Boolean))];
    
    stateNames.forEach(state => {
      // Filter for last 6 months only
      const stateData = filteredData.filter(r => {
        if (r['Certification state'] !== state) return false;
        if (!r.Applied) return false;
        const appliedDate = new Date(r.Applied);
        return appliedDate >= sixMonthsCutoff && appliedDate <= yesterday;
      });
      
      const applied = stateData.length;
      const enrolled = stateData.filter(r => r.Enrolled).length;
      
      // Skip states with no applications or no enrollments
      if (applied === 0 || enrolled === 0) return;
      
      // Conversion Rate
      const conversionRate = enrolled / applied;
      
      // Velocity (average days from Applied to Enrolled)
      const conversions = stateData.filter(r => r.Applied && r.Enrolled);
      let avgVelocity = 0;
      
      if (conversions.length > 0) {
        const totalDays = conversions.reduce((sum, app) => {
          const appliedDate = new Date(app.Applied);
          const enrolledDate = new Date(app.Enrolled);
          const days = Math.floor((enrolledDate - appliedDate) / (1000 * 60 * 60 * 24));
          return sum + (days > 0 ? days : 0);
        }, 0);
        avgVelocity = totalDays / conversions.length;
      }
      
      // Skip states with no velocity data
      if (avgVelocity === 0) return;
      
      // Scoring
      const conversionTarget = 0.50; // 50%
      const velocityTarget = 30; // 30 days
      
      // Conversion Score (uncapped)
      const conversionScore = (conversionRate / conversionTarget) * 100;
      
      // Velocity Score (square-root guardrail, uncapped)
      const velocityScore = Math.sqrt(velocityTarget / avgVelocity) * 100;
      
      // Final State Score (equal weighting)
      const stateScore = (0.5 * conversionScore) + (0.5 * velocityScore);
      
      stateScores.push({
        state,
        applied,
        enrolled,
        conversionRate: (conversionRate * 100).toFixed(1),
        avgVelocity: avgVelocity.toFixed(1),
        stateScore: stateScore.toFixed(1)
      });
    });
    
    // Sort by state score
    stateScores.sort((a, b) => parseFloat(b.stateScore) - parseFloat(a.stateScore));
    
    // Get top 3 and bottom 3
    const topStates = stateScores.slice(0, 3);
    const bottomStates = stateScores.slice(-3).reverse();

    // AGGREGATE CONVERSION SCORE TREND (Trailing 12 Months)
    // Calculate All States aggregate score for each of the past 12 months
    // NOTE: To avoid recency bias, we look at APPLICATIONS by month and track their
    // conversions within 90 days, excluding the most recent 2 months
    const conversionScoreTrend = [];
    
    // Start from 3 months ago to allow for conversion lag
    const startMonth = 2; // Skip most recent 2 months
    const totalMonths = 12;
    
    for (let i = startMonth; i < startMonth + totalMonths; i++) {
      const monthEnd = new Date(yesterday);
      monthEnd.setMonth(monthEnd.getMonth() - i);
      monthEnd.setDate(1); // Start of month
      monthEnd.setMonth(monthEnd.getMonth() + 1); // Move to next month
      monthEnd.setDate(0); // Last day of target month
      
      const monthStart = new Date(monthEnd);
      monthStart.setDate(1); // First day of month
      
      const monthLabel = monthEnd.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
      
      // Get all applications from this month (all states combined)
      const monthApplications = filteredData.filter(r => {
        if (!r.Applied) return false;
        const appliedDate = new Date(r.Applied);
        return appliedDate >= monthStart && appliedDate <= monthEnd;
      });
      
      const applied = monthApplications.length;
      
      if (applied === 0) {
        conversionScoreTrend.unshift({
          month: monthLabel,
          score: 0,
          applied: 0,
          enrolled: 0
        });
        continue;
      }
      
      // Count enrollments that happened within 90 days of application
      const enrolled = monthApplications.filter(r => {
        if (!r.Enrolled) return false;
        const appliedDate = new Date(r.Applied);
        const enrolledDate = new Date(r.Enrolled);
        const daysDiff = Math.floor((enrolledDate - appliedDate) / (1000 * 60 * 60 * 24));
        return daysDiff >= 0 && daysDiff <= 90;
      }).length;
      
      // Calculate conversion rate
      const conversionRate = enrolled / applied;
      
      // Velocity calculation (only for those who converted within 90 days)
      const conversions = monthApplications.filter(r => {
        if (!r.Applied || !r.Enrolled) return false;
        const appliedDate = new Date(r.Applied);
        const enrolledDate = new Date(r.Enrolled);
        const daysDiff = Math.floor((enrolledDate - appliedDate) / (1000 * 60 * 60 * 24));
        return daysDiff >= 0 && daysDiff <= 90;
      });
      
      let avgVelocity = 30; // Default to target if no conversions
      
      if (conversions.length > 0) {
        const totalDays = conversions.reduce((sum, app) => {
          const appliedDate = new Date(app.Applied);
          const enrolledDate = new Date(app.Enrolled);
          const days = Math.floor((enrolledDate - appliedDate) / (1000 * 60 * 60 * 24));
          return sum + days;
        }, 0);
        avgVelocity = totalDays / conversions.length;
      }
      
      // Calculate score (same formula as state scores)
      const conversionTarget = 0.50;
      const velocityTarget = 30;
      
      const conversionScore = (conversionRate / conversionTarget) * 100;
      const velocityScore = avgVelocity > 0 ? Math.sqrt(velocityTarget / avgVelocity) * 100 : 100;
      const aggregateScore = (0.5 * conversionScore) + (0.5 * velocityScore);
      
      conversionScoreTrend.unshift({
        month: monthLabel,
        score: parseFloat(aggregateScore.toFixed(1)),
        applied,
        enrolled
      });
    }

    // STATE MONTH-OVER-MONTH ENROLLMENT COMPARISON
    // Compare rolling 30 days vs prior 30 days for each state
    const today = new Date(now);
    today.setHours(0, 0, 0, 0);
    
    const thirtyDaysAgo = new Date(today);
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    
    const sixtyDaysAgo = new Date(today);
    sixtyDaysAgo.setDate(sixtyDaysAgo.getDate() - 60);
    
    // Get all unique states from raw data (not filtered)
    const allStateNames = [...new Set(rawData.map(r => r['Certification state']).filter(Boolean))];
    
    const stateMoMComparison = [];
    
    allStateNames.forEach(state => {
      const stateData = rawData.filter(r => r['Certification state'] === state);
      
      // Current period: last 30 days enrollments
      const currentPeriodEnrollments = stateData.filter(r => {
        if (!r.Enrolled) return false;
        const enrolledDate = new Date(r.Enrolled);
        return enrolledDate >= thirtyDaysAgo && enrolledDate < today;
      }).length;
      
      // Prior period: 30-60 days ago enrollments
      const priorPeriodEnrollments = stateData.filter(r => {
        if (!r.Enrolled) return false;
        const enrolledDate = new Date(r.Enrolled);
        return enrolledDate >= sixtyDaysAgo && enrolledDate < thirtyDaysAgo;
      }).length;
      
      // Calculate MoM growth
      let momGrowth = 0;
      let momGrowthRaw = 0;
      if (priorPeriodEnrollments > 0) {
        momGrowthRaw = ((currentPeriodEnrollments - priorPeriodEnrollments) / priorPeriodEnrollments) * 100;
        momGrowth = momGrowthRaw.toFixed(1);
      } else if (currentPeriodEnrollments > 0) {
        momGrowthRaw = 100; // New enrollments from zero
        momGrowth = '100.0';
      }
      
      // Only include states with at least some activity
      if (currentPeriodEnrollments > 0 || priorPeriodEnrollments > 0) {
        stateMoMComparison.push({
          state,
          currentPeriod: currentPeriodEnrollments,
          priorPeriod: priorPeriodEnrollments,
          change: currentPeriodEnrollments - priorPeriodEnrollments,
          momGrowth: parseFloat(momGrowth),
          momGrowthRaw
        });
      }
    });
    
    // Sort by MoM growth
    stateMoMComparison.sort((a, b) => b.momGrowthRaw - a.momGrowthRaw);
    
    // Get top and bottom performers
    const topMoMStates = stateMoMComparison.slice(0, 3);
    const bottomMoMStates = stateMoMComparison.filter(s => s.momGrowthRaw < 0).slice(-3).reverse();
    
    // If not enough negative growth states, get lowest positive ones
    const actualBottomMoM = bottomMoMStates.length > 0 
      ? bottomMoMStates 
      : stateMoMComparison.slice(-3).reverse();

    // APPLICATIONS AGE FUNNEL
    // Count applications by how long they've been in the system without enrolling
    // Limited to applications from the last 6 months
    const applicationsAgeFunnel = {
      under30: 0,
      days31to60: 0,
      days61to90: 0,
      over90: 0
    };

    filteredData.forEach(r => {
      if (!r.Applied) return;
      if (r.Enrolled) return; // Only count non-enrolled applications
      
      const appliedDate = new Date(r.Applied);
      
      // Only include applications from last 6 months
      if (appliedDate < sixMonthsCutoff || appliedDate > yesterday) return;
      
      const daysSinceApplied = Math.floor((yesterday - appliedDate) / (1000 * 60 * 60 * 24));
      
      if (daysSinceApplied < 30) {
        applicationsAgeFunnel.under30++;
      } else if (daysSinceApplied <= 60) {
        applicationsAgeFunnel.days31to60++;
      } else if (daysSinceApplied <= 90) {
        applicationsAgeFunnel.days61to90++;
      } else {
        applicationsAgeFunnel.over90++;
      }
    });

    // STATE PERFORMANCE MATRIX (4 Quadrants)
    // Calculate conversion rate and median velocity for each state
    const stateMatrixData = [];
    
    stateNames.forEach(state => {
      // Use 6-month data like state scores
      const stateData = filteredData.filter(r => {
        if (r['Certification state'] !== state) return false;
        if (!r.Applied) return false;
        const appliedDate = new Date(r.Applied);
        return appliedDate >= sixMonthsCutoff && appliedDate <= yesterday;
      });
      
      const applied = stateData.length;
      const enrolled = stateData.filter(r => r.Enrolled).length;
      
      // Need at least 10 applications for meaningful data
      if (applied < 10) return;
      
      const conversionRate = (enrolled / applied) * 100;
      
      // Calculate median velocity
      const velocities = stateData
        .filter(r => r.Applied && r.Enrolled)
        .map(r => {
          const appliedDate = new Date(r.Applied);
          const enrolledDate = new Date(r.Enrolled);
          return Math.floor((enrolledDate - appliedDate) / (1000 * 60 * 60 * 24));
        })
        .filter(d => d > 0)
        .sort((a, b) => a - b);
      
      let medianVelocity = 30; // Default
      if (velocities.length > 0) {
        const mid = Math.floor(velocities.length / 2);
        medianVelocity = velocities.length % 2 === 0
          ? (velocities[mid - 1] + velocities[mid]) / 2
          : velocities[mid];
      }
      
      // Determine quadrant
      let quadrant = '';
      if (conversionRate >= 50 && medianVelocity <= 30) {
        quadrant = 'Scale';
      } else if (conversionRate >= 50 && medianVelocity > 30) {
        quadrant = 'Operational upside';
      } else if (conversionRate < 50 && medianVelocity <= 30) {
        quadrant = 'Lead quality issue';
      } else {
        quadrant = 'Structural risk';
      }
      
      stateMatrixData.push({
        state,
        conversionRate: parseFloat(conversionRate.toFixed(1)),
        medianVelocity: parseFloat(medianVelocity.toFixed(1)),
        applied,
        enrolled,
        quadrant
      });
    });

    return {
      totalApplications,
      enrolled,
      dateEntered,
      dropped,
      enrollmentRate: parseFloat(enrollmentRate),
      completionRate: parseFloat(completionRate),
      retentionRate: parseFloat(retentionRate),
      last6MonthsApps: last6MonthsApps.length,
      last6MonthsEnrolled,
      last2YearsEnrolled: last2YearsEnrolled.length,
      last2YearsCompleted,
      avgEnrollmentTime,
      popularTimeSlot,
      popularTimeCount,
      timeOfDayBreakdown,
      stateBreakdown,
      semesterBreakdown,
      semesterTrends,
      semesterComparison,
      monthlyTrend,
      currentSemester,
      currentRank,
      totalSemesters: semesterTrends.length,
      // MTD metrics
      applicationsMTD,
      applicationsYoYGrowth: parseFloat(applicationsYoYGrowth),
      forecastMTD: Math.round(forecastAppsToUse),
      forecastVariance: parseFloat(forecastAppsVariance),
      enrollmentsMTD,
      enrollmentsYoYGrowth: parseFloat(enrollmentsYoYGrowth),
      forecastEnrollmentsMTD: Math.round(forecastEnrollToUse),
      forecastEnrollmentsVariance: parseFloat(forecastEnrollVariance),
      // YTD metrics
      applicationsYTD,
      applicationsYTDGrowth: parseFloat(applicationsYTDGrowth),
      forecastYTD: Math.round(forecastAppsYTDToUse),
      forecastYTDVariance: parseFloat(forecastAppsYTDVariance),
      enrollmentsYTD,
      enrollmentsYTDGrowth: parseFloat(enrollmentsYTDGrowth),
      forecastEnrollmentsYTD: Math.round(forecastEnrollYTDToUse),
      forecastEnrollmentsYTDVariance: parseFloat(forecastEnrollYTDVariance),
      // Spring Hires comparison
      spring2026Hires,
      spring2025Hires,
      springHiresGrowth: parseFloat(springHiresGrowth),
      fall2025Hires,
      currentlyPlacedTeachers,
      // Cohort analysis
      cohortAnalysis,
      conversionDistribution,
      monthlyTrendMeta,
      // Neat facts
      appPacingRank,
      appPacingTotal: allYears.length,
      enrollmentPacingRank,
      enrollmentPacingTotal: allYears.length,
      topState,
      // New metrics
      enrollmentToHiredRate: parseFloat(enrollmentToHiredRate),
      stateQuality,
      retentionRates,
      // State performance scores
      topStates,
      bottomStates,
      conversionScoreTrend,
      // State MoM enrollment comparison
      topMoMStates,
      bottomMoMStates: actualBottomMoM,
      stateMoMComparison,
      // Applications age funnel
      applicationsAgeFunnel,
      // State performance matrix
      stateMatrixData
    };
  };

  const fetchData = async (isInitial = false) => {
    if (isInitial) setLoading(true);
    try {
      let csvText;
      let dataSource = 'salesforce';
      
      // Try Salesforce first, fall back to Google Sheets
      try {
        console.log('Fetching data from Salesforce...');
        const sfResponse = await fetch(SALESFORCE_URL);
        if (!sfResponse.ok) {
          throw new Error(`Salesforce HTTP error: ${sfResponse.status}`);
        }
        csvText = await sfResponse.text();
        console.log('Salesforce CSV length:', csvText.length);
      } catch (sfError) {
        console.warn('Salesforce fetch failed, falling back to Google Sheets:', sfError.message);
        dataSource = 'google-sheets';
        const response = await fetch(SHEET_URL);
        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }
        csvText = await response.text();
        console.log('Google Sheets CSV length:', csvText.length);
      }
      
      const parsedData = parseCSV(csvText);
      console.log(`Parsed ${parsedData.length} rows from ${dataSource}`);
      
      // Fetch forecast data (don't fail if this errors)
      let parsedForecast = [];
      try {
        console.log('Fetching forecast from:', FORECAST_URL);
        const forecastResponse = await fetch(FORECAST_URL);
        if (forecastResponse.ok) {
          const forecastText = await forecastResponse.text();
          parsedForecast = parseCSV(forecastText);
          console.log('Parsed forecast rows:', parsedForecast.length);
        } else {
          console.warn('Forecast fetch failed, continuing without forecast data');
        }
      } catch (forecastError) {
        console.warn('Error fetching forecast data:', forecastError);
        // Continue without forecast data
      }
      
      setRawData(parsedData);
      setForecastData(parsedForecast);
      
      const calculatedMetrics = calculateMetrics(parsedData, selectedState, parsedForecast);
      console.log('Calculated metrics:', calculatedMetrics);
      
      setMetrics(calculatedMetrics);
      setLastUpdate(new Date());
      
      // Generate AI summary with loaded data
      generateAISummary(parsedData, calculatedMetrics);
    } catch (error) {
      console.error('Error fetching data:', error);
      alert('Error loading data: ' + error.message);
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchData(true);
    const interval = setInterval(() => fetchData(false), 300000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Fetch AI summary from stored global summary (GET only)
  // Generate AI summary from loaded data
  const generateAISummary = async (rawData, metrics) => {
    try {
      setNarrativeLoading(true);
      
      // Build snapshot
      const snapshot = buildKPISnapshot(rawData, metrics);
      
      // Volume guardrails
      if (snapshot.apps_last_30d < 300 || snapshot.enroll_last_30d < 100 || snapshot.matured_cohort_apps < 200) {
        setAiNarrative({ 
          summary: 'Insufficient volume for a stable summary.',
          generatedAt: new Date().toISOString(),
          isFallback: true 
        });
        setNarrativeLoading(false);
        return;
      }

      // Call AI endpoint with snapshot
      const response = await fetch('/.netlify/functions/kpi-summary-regenerate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-admin-token': 'PUBLIC_GENERATE' // We'll update the function to allow this
        },
        body: JSON.stringify(snapshot)
      });

      if (response.ok) {
        const data = await response.json();
        setAiNarrative({
          summary: data.summary,
          generatedAt: data.generated_at,
          isFallback: false
        });
      } else {
        setAiNarrative({ summary: "Summary generation failed.", isFallback: true });
      }
    } catch (error) {
      console.error('Error generating AI summary:', error);
      setAiNarrative({ summary: "Summary unavailable.", isFallback: true });
    } finally {
      setNarrativeLoading(false);
    }
  };

  // Build KPI snapshot for AI - LIMITED TO LAST 12 MONTHS
  const buildKPISnapshot = (rawData, metrics) => {
    const now = new Date();
    const twelveMonthsAgo = new Date(now);
    twelveMonthsAgo.setMonth(twelveMonthsAgo.getMonth() - 12);
    
    // Filter to last 12 months only
    const last12MonthsData = rawData.filter(r => {
      if (!r.Applied) return false;
      const appDate = new Date(r.Applied);
      return appDate >= twelveMonthsAgo && appDate <= now;
    });
    
    const thirtyDaysAgo = new Date(now);
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const sixtyDaysAgo = new Date(now);
    sixtyDaysAgo.setDate(sixtyDaysAgo.getDate() - 60);
    const oneDayAgo = new Date(now);
    oneDayAgo.setDate(oneDayAgo.getDate() - 1);

    const last30d = last12MonthsData.filter(r => r.Applied && new Date(r.Applied) >= thirtyDaysAgo);
    const prev30d = last12MonthsData.filter(r => {
      if (!r.Applied) return false;
      const date = new Date(r.Applied);
      return date >= sixtyDaysAgo && date < thirtyDaysAgo;
    });

    const apps_last_30d = last30d.length;
    const apps_prev_30d = prev30d.length;
    const apps_pct_change = apps_prev_30d > 0 ? ((apps_last_30d - apps_prev_30d) / apps_prev_30d * 100).toFixed(1) : 0;
    const enroll_last_30d = last30d.filter(r => r.Enrolled).length;
    const enroll_prev_30d = prev30d.filter(r => r.Enrolled).length;
    const enroll_pct_change = enroll_prev_30d > 0 ? ((enroll_last_30d - enroll_prev_30d) / enroll_prev_30d * 100).toFixed(1) : 0;

    const stateApps = {}, stateEnroll = {};
    last30d.forEach(r => {
      const state = r['Certification state'];
      if (!state) return;
      stateApps[state] = (stateApps[state] || 0) + 1;
      if (r.Enrolled) stateEnroll[state] = (stateEnroll[state] || 0) + 1;
    });

    const top_states_apps = Object.entries(stateApps).sort((a,b) => b[1]-a[1]).slice(0,3).map(([state, count]) => ({state, count}));
    const top_states_enroll = Object.entries(stateEnroll).sort((a,b) => b[1]-a[1]).slice(0,3).map(([state, count]) => ({state, count}));
    const top_state_share_apps = apps_last_30d > 0 && top_states_apps[0] ? ((top_states_apps[0].count / apps_last_30d) * 100).toFixed(1) : null;

    const maturedCohort = last12MonthsData.filter(r => r.Applied && new Date(r.Applied) >= sixtyDaysAgo && new Date(r.Applied) < thirtyDaysAgo);
    const matured_cohort_apps = maturedCohort.length;
    const matured_enrolled = maturedCohort.filter(r => r.Enrolled).length;
    const matured_conv_30d = matured_cohort_apps > 0 ? ((matured_enrolled / matured_cohort_apps) * 100).toFixed(1) : 0;

    const ninetyDaysAgo = new Date(now); ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
    const priorMaturedCohort = last12MonthsData.filter(r => r.Applied && new Date(r.Applied) >= ninetyDaysAgo && new Date(r.Applied) < sixtyDaysAgo);
    const prior_matured_enrolled = priorMaturedCohort.filter(r => r.Enrolled).length;
    const prior_matured_conv_30d = priorMaturedCohort.length > 0 ? ((prior_matured_enrolled / priorMaturedCohort.length) * 100).toFixed(1) : null;

    const maturedWithEnrollment = maturedCohort.filter(r => r.Enrolled && r.Applied);
    const maturedDays = maturedWithEnrollment.map(r => Math.max(0, Math.floor((new Date(r.Enrolled) - new Date(r.Applied)) / 86400000))).sort((a,b) => a-b);
    const matured_median_days_to_enroll = maturedDays.length > 0 ? maturedDays[Math.floor(maturedDays.length/2)] : null;

    const priorMaturedWithEnrollment = priorMaturedCohort.filter(r => r.Enrolled && r.Applied);
    const priorMaturedDays = priorMaturedWithEnrollment.map(r => Math.max(0, Math.floor((new Date(r.Enrolled) - new Date(r.Applied)) / 86400000))).sort((a,b) => a-b);
    const prior_matured_median_days_to_enroll = priorMaturedDays.length > 0 ? priorMaturedDays[Math.floor(priorMaturedDays.length/2)] : null;

    const last24h = last12MonthsData.filter(r => r.Applied && new Date(r.Applied) >= oneDayAgo);
    const notable_24h_movement = last24h.length >= 10;
    let notable_24h_driver_state = null, notable_24h_impact = null, notable_24h_reason = null;
    
    if (notable_24h_movement) {
      const state24h = {};
      last24h.forEach(r => { if (r['Certification state']) state24h[r['Certification state']] = (state24h[r['Certification state']] || 0) + 1; });
      const topState24h = Object.entries(state24h).sort((a,b) => b[1]-a[1])[0];
      if (topState24h && topState24h[1] >= 5) {
        notable_24h_driver_state = topState24h[0];
        notable_24h_impact = `${topState24h[1]} applications`;
        notable_24h_reason = 'high activity';
      }
    }

    return {
      as_of_date: now.toISOString().split('T')[0],
      apps_last_30d, apps_prev_30d, apps_pct_change: parseFloat(apps_pct_change),
      enroll_last_30d, enroll_prev_30d, enroll_pct_change: parseFloat(enroll_pct_change),
      top_states_apps, top_states_enroll, top_state_share_apps: top_state_share_apps ? parseFloat(top_state_share_apps) : null,
      matured_cohort_label: '30-60 days ago', matured_cohort_apps,
      matured_conv_30d: parseFloat(matured_conv_30d),
      prior_matured_conv_30d: prior_matured_conv_30d ? parseFloat(prior_matured_conv_30d) : null,
      matured_median_days_to_enroll, prior_matured_median_days_to_enroll,
      enroll_mtd: metrics?.enrollmentsMTD || null,
      mtd_enroll_target: metrics?.forecastEnrollmentsMTD || null,
      mtd_pacing_pct: metrics?.forecastEnrollmentsVariance || null,
      notable_24h_movement, notable_24h_driver_state, notable_24h_reason, notable_24h_impact
    };
  };

  // Fetch AI-generated narrative
  const fetchNarrative = async () => {
    try {
      setNarrativeLoading(true);
      
      // Create abort controller with 30 second timeout
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 30000);
      
      // Call the working function directly
      const response = await fetch('/.netlify/functions/generate-narrative', {
        signal: controller.signal
      });
      
      clearTimeout(timeoutId);
      
      if (response.ok) {
        const data = await response.json();
        console.log('Narrative loaded:', data);
        setAiNarrative(data);
      } else {
        console.error('Narrative fetch failed:', response.status);
        setAiNarrative({
          narrative: "AI insights will be generated daily at 6 AM CT. The first generation may take up to 30 seconds.",
          isFallback: true
        });
      }
    } catch (error) {
      console.error('Error fetching narrative:', error);
      if (error.name === 'AbortError') {
        console.log('Narrative fetch timed out after 30s');
      }
      setAiNarrative({
        narrative: "AI insights are being generated. This may take up to 30 seconds on first load. Please refresh in a moment.",
        isFallback: true
      });
    } finally {
      setNarrativeLoading(false);
    }
  };

  // Recalculate metrics when state filter changes
  useEffect(() => {
    if (rawData.length > 0) {
      const calculatedMetrics = calculateMetrics(rawData, selectedState, forecastData);
      console.log('Recalculated metrics for state:', selectedState);
      setMetrics(calculatedMetrics);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedState]);

  const generateNarrative = () => {
    if (!metrics) return '';
    
    const { currentSemester, currentRank, totalSemesters, enrollmentRate, completionRate, totalApplications, enrolled } = metrics;
    
    if (!currentSemester) {
      return `We've processed ${totalApplications} total applications with an enrollment rate of ${enrollmentRate}%. Of those enrolled, ${completionRate}% have successfully entered the program.`;
    }

    const semesterName = currentSemester.semester.replace('*', '');
    return `${semesterName} shows ${currentSemester.students} students enrolled, ranking #${currentRank} of ${totalSemesters} semesters all-time. Our current enrollment conversion rate stands at ${enrollmentRate}%, with ${enrolled} students enrolled from ${totalApplications} total applications. The program completion rate for enrolled students is ${completionRate}%, demonstrating strong student commitment and program quality.`;
  };

  const handleAccessSubmit = () => {
    if (accessCode.toLowerCase() === 'gomeangreen') {
      setAccessGranted(true);
      setAccessError(false);
    } else {
      setAccessError(true);
    }
  };

  if (!accessGranted || loading) {
    return (
      <div className="loading-container">
        <div className="loading-inner">
          {/* Butterfly animation - always playing on loop */}
          <ButterflyLoader 
            animate={true}
            sizePx={220}
            durationMs={2600}
            staggerMs={160}
            floatAfterAssemble={true}
            style={{ marginBottom: '0rem' }}
          />
          
          {/* Company Logo */}
          <img
            src={`${process.env.PUBLIC_URL}/iteach-only.png`}
            alt="iTeach"
            className="loading-logo"
            style={{ marginBottom: '0.5rem' }}
          />
          
          {!accessGranted ? (
            <div className="access-gate">
              <input
                type="password"
                className={`access-input${accessError ? ' access-input-error' : ''}`}
                placeholder="Enter access code"
                value={accessCode}
                onChange={(e) => { setAccessCode(e.target.value); setAccessError(false); }}
                onKeyDown={(e) => e.key === 'Enter' && handleAccessSubmit()}
                autoFocus
              />
              {accessError && <p className="access-error-text">Invalid access code</p>}
              <button className="access-button" onClick={handleAccessSubmit}>Access</button>
            </div>
          ) : (
            <p className="loading-tagline">Gathering data...</p>
          )}
        </div>
      </div>
    );
  }

  const stateData = metrics ? Object.entries(metrics.stateBreakdown).map(([state, count]) => ({
    name: state,
    value: count
  })) : [];

  // Get unique states from raw data
  const availableStates = ['All States', ...new Set(rawData.map(r => r['Certification state']).filter(Boolean).sort())];

  const COLORS = ['#3B82F6', '#8B5CF6', '#EC4899', '#10B981', '#F59E0B', '#EF4444'];

  // Enhanced summary text formatting
  const enhanceSummaryText = (summary) => {
    if (!summary) return '';
    
    // Bold all numbers (with commas, percentages, etc.) - NO color change, NO size change
    let enhanced = summary.replace(/(\d{1,3}(,\d{3})*(\.\d+)?%?)/g, '<strong class="number-highlight">$1</strong>');
    
    // Add structure indicators for key phrases
    enhanced = enhanced.replace(/(Last \d+ days:|Notable:|However,|Additionally,)/gi, '<span class="key-phrase">$1</span>');
    
    // Highlight action items if present
    enhanced = enhanced.replace(/(Action:|Focus:|Monitor:|Watch:)/gi, '<strong class="action-highlight">$1</strong>');
    
    // Add "Needed Focus" directive based on metrics
    const focusDirective = generateFocusDirective();
    if (focusDirective) {
      enhanced += `<div class="focus-directive"><strong class="focus-label">Needed Focus:</strong> ${focusDirective}</div>`;
    }
    
    return enhanced;
  };

  // Generate focus directive based on current metrics
  const generateFocusDirective = () => {
    if (!metrics || !rawData) return null;
    
    const appsGrowth = metrics.applicationsYoYGrowth || 0;
    const enrollGrowth = metrics.enrollmentsYoYGrowth || 0;
    const appsForecast = metrics.forecastVariance || 0;
    const enrollForecast = metrics.forecastEnrollmentsVariance || 0;
    
    const directives = [];
    
    // Enrollment issues
    if (enrollForecast < -10) {
      directives.push('Accelerate enrollment outreach immediately');
    } else if (enrollGrowth < -5) {
      directives.push('Review and address enrollment conversion blockers');
    }
    
    // Application issues
    if (appsForecast < -10) {
      directives.push('Boost pipeline generation activities');
    } else if (appsGrowth < -5) {
      directives.push('Increase marketing and recruitment efforts');
    }
    
    // Funnel tension
    if (appsGrowth > 5 && enrollGrowth < -5) {
      directives.push('Investigate gap between applications and enrollments');
    }
    
    // State concentration risk - use LAST 12 MONTHS data only
    const now = new Date();
    const twelveMonthsAgo = new Date(now);
    twelveMonthsAgo.setMonth(twelveMonthsAgo.getMonth() - 12);
    
    // Filter to last 12 months
    const last12MonthsData = rawData.filter(r => {
      if (!r.Applied) return false;
      const appDate = new Date(r.Applied);
      return appDate >= twelveMonthsAgo && appDate <= now;
    });
    
    // Calculate state breakdown for last 12 months
    const stateApps12M = {};
    last12MonthsData.forEach(r => {
      const state = r['Certification state'];
      if (state) {
        stateApps12M[state] = (stateApps12M[state] || 0) + 1;
      }
    });
    
    const total12M = last12MonthsData.length;
    const topStates12M = Object.entries(stateApps12M)
      .map(([state, count]) => ({
        state,
        count,
        percentage: total12M > 0 ? (count / total12M) * 100 : 0
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 3);
    
    // Only flag if a single state is >30% of volume
    if (topStates12M.length > 0 && topStates12M[0].percentage > 30) {
      directives.push(`Monitor ${topStates12M[0].state} concentration (${topStates12M[0].percentage.toFixed(0)}% of volume)`);
    }
    
    // If everything is good
    if (directives.length === 0) {
      if (appsGrowth > 10 && enrollGrowth > 10) {
        directives.push('Maintain current momentum, ensure capacity to handle growth');
      } else {
        directives.push('Continue monitoring key metrics, maintain current strategies');
      }
    }
    
    // Return up to 3 directives
    return directives.slice(0, 3).join('; ');
  };

  // Generate focus directive for Applications Age card
  const generateApplicationsAgeFocus = () => {
    if (!metrics?.applicationsAgeFunnel) return null;
    
    const { under30, days31to60, days61to90, over90 } = metrics.applicationsAgeFunnel;
    const total = (under30 || 0) + (days31to60 || 0) + (days61to90 || 0) + (over90 || 0);
    
    if (total === 0) return null;
    
    const over90Pct = ((over90 || 0) / total) * 100;
    const days61to90Pct = ((days61to90 || 0) / total) * 100;
    const stalePct = over90Pct + days61to90Pct;
    
    // High risk: >40% of apps are 60+ days old
    if (stalePct > 40) {
      return `${stalePct.toFixed(0)}% of applications are 60+ days old - prioritize immediate outreach to aging pipeline`;
    }
    
    // Medium risk: >25% are 90+ days old
    if (over90Pct > 25) {
      return `${over90Pct.toFixed(0)}% of applications are 90+ days old - risk of abandonment is high`;
    }
    
    // Medium risk: >30% are 60+ days old
    if (stalePct > 30) {
      return `${stalePct.toFixed(0)}% of applications are 60+ days old - accelerate conversion efforts`;
    }
    
    // Positive: Most apps are fresh
    if ((under30 || 0) / total > 0.6) {
      return `Pipeline is fresh with ${((under30 || 0) / total * 100).toFixed(0)}% of applications under 30 days old`;
    }
    
    return null;
  };

  // Generate focus directive for Performance Summary
  const generatePerformanceFocus = () => {
    if (!metrics) return null;
    
    const appsGrowth = metrics.applicationsYoYGrowth || 0;
    const enrollGrowth = metrics.enrollmentsYoYGrowth || 0;
    const appsForecast = metrics.forecastVariance || 0;
    const enrollForecast = metrics.forecastEnrollmentsVariance || 0;
    
    // CRITICAL: Apps growing but enrollments declining (misalignment)
    if (appsGrowth > 5 && enrollGrowth < -5) {
      return `Applications up ${appsGrowth.toFixed(0)}% but enrollments down ${Math.abs(enrollGrowth).toFixed(0)}% - investigate conversion funnel immediately`;
    }
    
    // HIGH RISK: Both declining
    if (appsGrowth < -10 && enrollGrowth < -10) {
      return `Both applications and enrollments declining significantly - urgent intervention needed`;
    }
    
    // MEDIUM RISK: Enrollments declining while apps flat/positive
    if (enrollGrowth < -10 && appsGrowth > -5) {
      return `Enrollments down ${Math.abs(enrollGrowth).toFixed(0)}% despite stable applications - focus on conversion barriers`;
    }
    
    // MEDIUM RISK: Applications declining while enrolls flat/positive
    if (appsGrowth < -10 && enrollGrowth > -5) {
      return `Applications down ${Math.abs(appsGrowth).toFixed(0)}% - increase pipeline generation to maintain enrollment levels`;
    }
    
    // WARNING: Behind forecast significantly
    if (enrollForecast < -15) {
      return `Enrollments ${Math.abs(enrollForecast).toFixed(0)}% behind forecast - accelerate outreach and follow-up`;
    }
    
    // POSITIVE: Both growing strongly
    if (appsGrowth > 10 && enrollGrowth > 10) {
      return `Strong growth in both applications (+${appsGrowth.toFixed(0)}%) and enrollments (+${enrollGrowth.toFixed(0)}%) - maintain momentum`;
    }
    
    // POSITIVE: Aligned growth
    if (appsGrowth > 0 && enrollGrowth > 0 && Math.abs(appsGrowth - enrollGrowth) < 10) {
      return `Applications and enrollments growing in alignment - healthy funnel performance`;
    }
    
    return null;
  };

  return (
    <div className="dashboard-container">
      <div className="dashboard-content">
        <div className="header">
          <div className="header-left">
            <img src={`${process.env.PUBLIC_URL}/iteach-logo.png`} alt="iteach logo" className="header-logo" />
            <div className="header-text">
              <h1 className="title">Pipeline Report</h1>
              <p className="subtitle">High level review of key pipeline data points</p>
            </div>
          </div>
          <div className="header-right">
            <div className="state-filter-container">
              <label htmlFor="state-filter" className="state-filter-label">Filter by State:</label>
              <select 
                id="state-filter"
                className="state-filter-dropdown"
                value={selectedState}
                onChange={(e) => setSelectedState(e.target.value)}
              >
                {availableStates.map(state => (
                  <option key={state} value={state}>{state}</option>
                ))}
              </select>
            </div>
            <button onClick={fetchData} className="refresh-button">
              <RefreshCw size={16} />
              <span>Refresh</span>
            </button>
          </div>
        </div>

        {/* AI-Generated KPI Summary - Enhanced */}
        <div className="ai-narrative-card-enhanced">
          <div className="ai-narrative-header">
            <div className="ai-header-left">
              <span className="ai-badge-enhanced">📊 Executive Summary</span>
              <span className="ai-status-indicator" style={{ 
                color: aiNarrative?.isFallback ? '#F59E0B' : '#10B981' 
              }}>
                {aiNarrative?.isFallback ? '⚠️' : '✓'}
              </span>
            </div>
            {aiNarrative?.generatedAt && !aiNarrative?.isFallback && (
              <span className="ai-timestamp">
                Updated: {new Date(aiNarrative.generatedAt).toLocaleString('en-US', { 
                  month: 'short', 
                  day: 'numeric',
                  hour: 'numeric',
                  minute: '2-digit'
                })}
              </span>
            )}
          </div>
          <div className="ai-narrative-content-enhanced">
            {narrativeLoading ? (
              <div className="ai-narrative-loading">
                <div className="loading-spinner"></div>
                <span>Analyzing metrics and generating insights...</span>
              </div>
            ) : aiNarrative ? (
              <div className="ai-summary-text" dangerouslySetInnerHTML={{ 
                __html: enhanceSummaryText(aiNarrative.summary) 
              }}></div>
            ) : (
              <p>Summary will appear here shortly.</p>
            )}
          </div>
        </div>

        {/* Performance Summary - Moved to top */}
        <div className="performance-summary-card">
          <h2 className="section-title">
            <Calendar size={20} />
            <span>Performance Summary (Through Yesterday)</span>
          </h2>
          
          {/* Needed Focus for Performance Summary */}
          {generatePerformanceFocus() && (
            <div className="card-focus-directive">
              <strong className="focus-label">Needed Focus:</strong> {generatePerformanceFocus()}
            </div>
          )}
          
          <div className="performance-grid">
            {/* Applications Column */}
            <div className="performance-column-card">
              <h3 className="performance-column-title">Applications</h3>
              
              <div className="performance-column-content">
                <div className="mtd-section">
                  <h4 className="mtd-title">Month to Date</h4>
                  <div className="mtd-stats">
                    <div className="mtd-stat-item">
                      <span className="mtd-label">Actual:</span>
                      <span className="mtd-value">{metrics?.applicationsMTD?.toLocaleString() || 0}</span>
                    </div>
                    <div className="mtd-stat-item">
                      <span className="mtd-label">YoY Growth:</span>
                      <span className={`mtd-value ${metrics?.applicationsYoYGrowth >= 0 ? 'growth-positive' : 'growth-negative'}`}>
                        {metrics?.applicationsYoYGrowth >= 0 ? '+' : ''}{metrics?.applicationsYoYGrowth || 0}%
                      </span>
                    </div>
                  </div>
                  <div className="mtd-stats" style={{ marginTop: '0.5rem', paddingTop: '0.5rem', borderTop: '1px solid rgba(255,255,255,0.1)' }}>
                    <div className="mtd-stat-item">
                      <span className="mtd-label">Forecast:</span>
                      <span className="mtd-value" style={{ fontStyle: 'italic', fontSize: '0.95em' }}>{metrics?.forecastMTD?.toLocaleString() || 0}</span>
                    </div>
                    <div className="mtd-stat-item">
                      <span className="mtd-label">vs Forecast:</span>
                      <span className={`mtd-value ${metrics?.forecastVariance >= 0 ? 'growth-positive' : 'growth-negative'}`} style={{ fontStyle: 'italic', fontSize: '0.95em' }}>
                        {metrics?.forecastVariance >= 0 ? '+' : ''}{metrics?.forecastVariance || 0}%
                      </span>
                    </div>
                  </div>
                </div>

                <div className="mtd-section">
                  <h4 className="mtd-title">Year to Date</h4>
                  <div className="mtd-stats">
                    <div className="mtd-stat-item">
                      <span className="mtd-label">Actual:</span>
                      <span className="mtd-value">{metrics?.applicationsYTD?.toLocaleString() || 0}</span>
                    </div>
                    <div className="mtd-stat-item">
                      <span className="mtd-label">YoY Growth:</span>
                      <span className={`mtd-value ${metrics?.applicationsYTDGrowth >= 0 ? 'growth-positive' : 'growth-negative'}`}>
                        {metrics?.applicationsYTDGrowth >= 0 ? '+' : ''}{metrics?.applicationsYTDGrowth || 0}%
                      </span>
                    </div>
                  </div>
                  <div className="mtd-stats" style={{ marginTop: '0.5rem', paddingTop: '0.5rem', borderTop: '1px solid rgba(255,255,255,0.1)' }}>
                    <div className="mtd-stat-item">
                      <span className="mtd-label">Forecast:</span>
                      <span className="mtd-value" style={{ fontStyle: 'italic', fontSize: '0.95em' }}>{metrics?.forecastYTD?.toLocaleString() || 0}</span>
                    </div>
                    <div className="mtd-stat-item">
                      <span className="mtd-label">vs Forecast:</span>
                      <span className={`mtd-value ${metrics?.forecastYTDVariance >= 0 ? 'growth-positive' : 'growth-negative'}`} style={{ fontStyle: 'italic', fontSize: '0.95em' }}>
                        {metrics?.forecastYTDVariance >= 0 ? '+' : ''}{metrics?.forecastYTDVariance || 0}%
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Enrollments Column */}
            <div className="performance-column-card">
              <h3 className="performance-column-title">Enrollments</h3>
              
              <div className="performance-column-content">
                <div className="mtd-section">
                  <h4 className="mtd-title">Month to Date</h4>
                  <div className="mtd-stats">
                    <div className="mtd-stat-item">
                      <span className="mtd-label">Actual:</span>
                      <span className="mtd-value">{metrics?.enrollmentsMTD?.toLocaleString() || 0}</span>
                    </div>
                    <div className="mtd-stat-item">
                      <span className="mtd-label">YoY Growth:</span>
                      <span className={`mtd-value ${metrics?.enrollmentsYoYGrowth >= 0 ? 'growth-positive' : 'growth-negative'}`}>
                        {metrics?.enrollmentsYoYGrowth >= 0 ? '+' : ''}{metrics?.enrollmentsYoYGrowth || 0}%
                      </span>
                    </div>
                  </div>
                  <div className="mtd-stats" style={{ marginTop: '0.5rem', paddingTop: '0.5rem', borderTop: '1px solid rgba(255,255,255,0.1)' }}>
                    <div className="mtd-stat-item">
                      <span className="mtd-label">Forecast:</span>
                      <span className="mtd-value" style={{ fontStyle: 'italic', fontSize: '0.95em' }}>{metrics?.forecastEnrollmentsMTD?.toLocaleString() || 0}</span>
                    </div>
                    <div className="mtd-stat-item">
                      <span className="mtd-label">vs Forecast:</span>
                      <span className={`mtd-value ${metrics?.forecastEnrollmentsVariance >= 0 ? 'growth-positive' : 'growth-negative'}`} style={{ fontStyle: 'italic', fontSize: '0.95em' }}>
                        {metrics?.forecastEnrollmentsVariance >= 0 ? '+' : ''}{metrics?.forecastEnrollmentsVariance || 0}%
                      </span>
                    </div>
                  </div>
                </div>

                <div className="mtd-section">
                  <h4 className="mtd-title">Year to Date</h4>
                  <div className="mtd-stats">
                    <div className="mtd-stat-item">
                      <span className="mtd-label">Actual:</span>
                      <span className="mtd-value">{metrics?.enrollmentsYTD?.toLocaleString() || 0}</span>
                    </div>
                    <div className="mtd-stat-item">
                      <span className="mtd-label">YoY Growth:</span>
                      <span className={`mtd-value ${metrics?.enrollmentsYTDGrowth >= 0 ? 'growth-positive' : 'growth-negative'}`}>
                        {metrics?.enrollmentsYTDGrowth >= 0 ? '+' : ''}{metrics?.enrollmentsYTDGrowth || 0}%
                      </span>
                    </div>
                  </div>
                  <div className="mtd-stats" style={{ marginTop: '0.5rem', paddingTop: '0.5rem', borderTop: '1px solid rgba(255,255,255,0.1)' }}>
                    <div className="mtd-stat-item">
                      <span className="mtd-label">Forecast:</span>
                      <span className="mtd-value" style={{ fontStyle: 'italic', fontSize: '0.95em' }}>{metrics?.forecastEnrollmentsYTD?.toLocaleString() || 0}</span>
                    </div>
                    <div className="mtd-stat-item">
                      <span className="mtd-label">vs Forecast:</span>
                      <span className={`mtd-value ${metrics?.forecastEnrollmentsYTDVariance >= 0 ? 'growth-positive' : 'growth-negative'}`} style={{ fontStyle: 'italic', fontSize: '0.95em' }}>
                        {metrics?.forecastEnrollmentsYTDVariance >= 0 ? '+' : ''}{metrics?.forecastEnrollmentsYTDVariance || 0}%
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Hires Column */}
            <div className="performance-column-card">
              <h3 className="performance-column-title">Hires (Spring)</h3>
              
              <div className="performance-column-content">
                <div className="mtd-section">
                  <h4 className="mtd-title">Spring 2026</h4>
                  <div className="mtd-stats">
                    <div className="mtd-stat-item">
                      <span className="mtd-label">Total:</span>
                      <span className="mtd-value">{metrics?.spring2026Hires?.toLocaleString() || 0}</span>
                    </div>
                    <div className="mtd-stat-item">
                      <span className="mtd-label">YoY Growth:</span>
                      <span className={`mtd-value ${metrics?.springHiresGrowth >= 0 ? 'growth-positive' : 'growth-negative'}`}>
                        {metrics?.springHiresGrowth >= 0 ? '+' : ''}{metrics?.springHiresGrowth || 0}%
                      </span>
                    </div>
                  </div>
                </div>

                <div className="mtd-section">
                  <h4 className="mtd-title">Spring 2025</h4>
                  <div className="mtd-stats">
                    <div className="mtd-stat-item">
                      <span className="mtd-label">Total:</span>
                      <span className="mtd-value">{metrics?.spring2025Hires?.toLocaleString() || 0}</span>
                    </div>
                    <div className="mtd-stat-item">
                      <span className="mtd-label">Same period last year</span>
                    </div>
                  </div>
                </div>

                <div className="mtd-section">
                  <h4 className="mtd-title">Currently Placed Teachers</h4>
                  <div className="mtd-stats">
                    <div className="mtd-stat-item" style={{ justifyContent: 'flex-end', textAlign: 'right' }}>
                      <span className="mtd-value" style={{ fontSize: '2rem', color: '#CFFB5E' }}>{metrics?.currentlyPlacedTeachers?.toLocaleString() || 0}</span>
                    </div>
                    <div className="mtd-stat-item" style={{ justifyContent: 'flex-end', textAlign: 'right' }}>
                      <span className="mtd-label" style={{ fontStyle: 'italic', fontSize: '0.75rem', opacity: 0.7 }}>Based on school year 2025-26</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="narrative-footer">
            <div className="footer-text">
              Last updated: {lastUpdate.toLocaleString()}
            </div>
          </div>
        </div>

        {/* Highlights Section - Now separate cards */}
        <div className="highlights-grid">
          <div className="highlight-card">
            <div className="neat-fact-icon">📈</div>
            <div className="neat-fact-content">
              <h4 className="neat-fact-title">Application Pacing</h4>
              <div className="neat-fact-value">
                #{metrics?.appPacingRank || 'N/A'} <span className="neat-fact-unit">of {metrics?.appPacingTotal || 0} years</span>
              </div>
              <div className="neat-fact-description">
                Ranked by apps received MTD vs all previous years
              </div>
            </div>
          </div>

          <div className="highlight-card">
            <div className="neat-fact-icon">🎓</div>
            <div className="neat-fact-content">
              <h4 className="neat-fact-title">Enrollment Pacing</h4>
              <div className="neat-fact-value">
                #{metrics?.enrollmentPacingRank || 'N/A'} <span className="neat-fact-unit">of {metrics?.enrollmentPacingTotal || 0} years</span>
              </div>
              <div className="neat-fact-description">
                Ranked by enrollments MTD vs all previous years
              </div>
            </div>
          </div>

          <div className="highlight-card">
            <div className="neat-fact-icon">🕐</div>
            <div className="neat-fact-content">
              <h4 className="neat-fact-title">Popular Time (6mo)</h4>
              <div className="neat-fact-value">
                {metrics?.popularTimeSlot || 'N/A'}
              </div>
              <div className="neat-fact-description">
                {metrics?.popularTimeCount || 0} applications
              </div>
            </div>
          </div>
        </div>

        {/* Applications Age Funnel - Stacked Bar */}
        <div className="chart-card chart-full" style={{ marginTop: '2rem' }} id="applications-age">
          <h3 className="chart-title">Applications Age Distribution (Last 6 Months, Non-Enrolled)</h3>
          
          {/* Needed Focus for Applications Age */}
          {generateApplicationsAgeFocus() && (
            <div className="card-focus-directive">
              <strong className="focus-label">Needed Focus:</strong> {generateApplicationsAgeFocus()}
            </div>
          )}
          
          {/* Single stacked bar */}
          <div style={{ marginTop: '1.5rem' }}>
            {(() => {
              const total = (metrics?.applicationsAgeFunnel?.under30 || 0) + 
                           (metrics?.applicationsAgeFunnel?.days31to60 || 0) + 
                           (metrics?.applicationsAgeFunnel?.days61to90 || 0) + 
                           (metrics?.applicationsAgeFunnel?.over90 || 0);
              
              const stages = [
                { label: '<30 days', count: metrics?.applicationsAgeFunnel?.under30 || 0, color: '#4BD48D' },
                { label: '31-60 days', count: metrics?.applicationsAgeFunnel?.days31to60 || 0, color: '#00BEA8' },
                { label: '61-90 days', count: metrics?.applicationsAgeFunnel?.days61to90 || 0, color: '#FFA500' },
                { label: '90+ days', count: metrics?.applicationsAgeFunnel?.over90 || 0, color: '#FF6B6B' }
              ];
              
              return (
                <>
                  <div style={{ 
                    display: 'flex', 
                    width: '100%', 
                    height: '60px', 
                    borderRadius: '8px', 
                    overflow: 'hidden',
                    border: '1px solid rgba(255,255,255,0.2)'
                  }}>
                    {stages.map((stage, idx) => {
                      const percentage = total > 0 ? (stage.count / total) * 100 : 0;
                      
                      return percentage > 0 ? (
                        <div 
                          key={idx}
                          title={`${stage.label}: ${stage.count} (${percentage.toFixed(1)}%)`}
                          style={{ 
                            width: `${percentage}%`,
                            background: stage.color,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            cursor: 'pointer',
                            transition: 'opacity 0.2s',
                            position: 'relative'
                          }}
                          onMouseEnter={(e) => e.currentTarget.style.opacity = '0.8'}
                          onMouseLeave={(e) => e.currentTarget.style.opacity = '1'}
                        >
                          {percentage > 8 && (
                            <div style={{ 
                              color: 'white', 
                              fontWeight: '600', 
                              fontSize: '0.9rem',
                              textShadow: '0 1px 2px rgba(0,0,0,0.3)'
                            }}>
                              {percentage.toFixed(0)}%
                            </div>
                          )}
                        </div>
                      ) : null;
                    })}
                  </div>
                  
                  {/* Legend */}
                  <div style={{ 
                    display: 'flex', 
                    justifyContent: 'center', 
                    gap: '2rem', 
                    marginTop: '1rem',
                    flexWrap: 'wrap'
                  }}>
                    {stages.map((stage, idx) => (
                      <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <div style={{ 
                          width: '16px', 
                          height: '16px', 
                          backgroundColor: stage.color, 
                          borderRadius: '3px' 
                        }}></div>
                        <span style={{ fontSize: '0.875rem' }}>
                          {stage.label}: {stage.count} ({total > 0 ? ((stage.count / total) * 100).toFixed(1) : 0}%)
                        </span>
                      </div>
                    ))}
                  </div>
                  
                  <div style={{ 
                    fontSize: '0.75rem', 
                    color: 'rgba(255,255,255,0.6)', 
                    marginTop: '0.75rem', 
                    textAlign: 'center' 
                  }}>
                    Total: {total.toLocaleString()} non-enrolled applications
                  </div>
                </>
              );
            })()}
          </div>
        </div>


        {/* Cohort Conversion Analysis Card */}
        <div className="cohort-analysis-card" id="conversion-speed">
          <h2 className="section-title">
            <TrendingUp size={20} />
            <span>Conversion Speed Analysis</span>
          </h2>
          
          <div className="cohort-grid">
            {/* Overall Distribution */}
            <div className="cohort-distribution">
              <h3 className="cohort-subtitle">Conversion Distribution (Last Year)</h3>
              <div className="distribution-bars">
                {(() => {
                  const dist = metrics?.conversionDistribution || {};
                  const totalApps = (dist.within30 || 0) + (dist.within60 || 0) + (dist.within90 || 0) + (dist.within180 || 0) + (dist.over180 || 0);
                  
                  return (
                    <>
                      <div className="distribution-item">
                        <div className="distribution-label">
                          <span className="label-text">0-30 days</span>
                          <span className="label-count">
                            {dist.within30 || 0} apps
                          </span>
                        </div>
                        <div className="distribution-bar-container">
                          <div 
                            className="distribution-bar bar-green"
                            style={{ 
                              width: `${totalApps > 0 ? (dist.within30 / totalApps) * 100 : 0}%`,
                              backgroundColor: '#4BD48D'
                            }}
                          ></div>
                        </div>
                      </div>

                      <div className="distribution-item">
                        <div className="distribution-label">
                          <span className="label-text">31-60 days</span>
                          <span className="label-count">
                            {dist.within60 || 0} apps
                          </span>
                        </div>
                        <div className="distribution-bar-container">
                          <div 
                            className="distribution-bar bar-blue"
                            style={{ 
                              width: `${totalApps > 0 ? (dist.within60 / totalApps) * 100 : 0}%`,
                              backgroundColor: '#00BEA8'
                            }}
                          ></div>
                        </div>
                      </div>

                      <div className="distribution-item">
                        <div className="distribution-label">
                          <span className="label-text">61-90 days</span>
                          <span className="label-count">
                            {dist.within90 || 0} apps
                          </span>
                        </div>
                        <div className="distribution-bar-container">
                          <div 
                            className="distribution-bar bar-purple"
                            style={{ 
                              width: `${totalApps > 0 ? (dist.within90 / totalApps) * 100 : 0}%`,
                              backgroundColor: '#026FBF'
                            }}
                          ></div>
                        </div>
                      </div>

                      <div className="distribution-item">
                        <div className="distribution-label">
                          <span className="label-text">91-180 days</span>
                          <span className="label-count">
                            {dist.within180 || 0} apps
                          </span>
                        </div>
                        <div className="distribution-bar-container">
                          <div 
                            className="distribution-bar bar-yellow"
                            style={{ 
                              width: `${totalApps > 0 ? (dist.within180 / totalApps) * 100 : 0}%`,
                              backgroundColor: '#026ABD'
                            }}
                          ></div>
                        </div>
                      </div>

                      <div className="distribution-item">
                        <div className="distribution-label">
                          <span className="label-text">180+ days</span>
                          <span className="label-count">
                            {dist.over180 || 0} apps
                          </span>
                        </div>
                        <div className="distribution-bar-container">
                          <div 
                            className="distribution-bar bar-red"
                            style={{ 
                              width: `${totalApps > 0 ? (dist.over180 / totalApps) * 100 : 0}%`,
                              backgroundColor: '#001997'
                            }}
                          ></div>
                        </div>
                      </div>
                    </>
                  );
                })()}
              </div>
            </div>

            {/* Cohort Trend Chart */}
            <div className="cohort-chart">
              <h3 className="cohort-subtitle">Monthly Cohort Performance (Last 9 Months)</h3>
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={metrics?.cohortAnalysis || []}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" />
                  <XAxis 
                    dataKey="month" 
                    stroke="#E0E7FF"
                    style={{ fontSize: '0.75rem' }}
                  />
                  <YAxis 
                    stroke="#E0E7FF"
                    label={{ value: '% of Applications', angle: -90, position: 'insideLeft', fill: '#E0E7FF' }}
                    style={{ fontSize: '0.875rem' }}
                  />
                  <Tooltip
                    contentStyle={{ 
                      backgroundColor: 'rgba(30, 27, 75, 0.95)', 
                      border: '1px solid rgba(255,255,255,0.2)', 
                      borderRadius: '8px' 
                    }}
                    labelStyle={{ color: '#E0E7FF' }}
                    formatter={(value) => `${value}%`}
                  />
                  <Legend />
                  <Bar dataKey="within30" stackId="a" fill="#4BD48D" name="0-30 days" />
                  <Bar dataKey="within60" stackId="a" fill="#00BEA8" name="31-60 days" />
                  <Bar dataKey="within90" stackId="a" fill="#026FBF" name="61-90 days" />
                  <Bar dataKey="within180" stackId="a" fill="#026ABD" name="91-180 days" />
                  <Bar dataKey="over180" stackId="a" fill="#001997" name="180+ days" />
                </BarChart>
              </ResponsiveContainer>
              <div className="cohort-note">
                <strong>Note:</strong> Shows % of applications from each month that converted within each timeframe. 
                Newer cohorts may have lower totals as they haven't had time to convert yet.
              </div>
            </div>
          </div>
        </div>

        <div className="chart-card chart-full" style={{ marginTop: '2rem' }} id="conversion-score">
          <h3 className="chart-title">Applied Conversion Score</h3>
          <div style={{ fontSize: '0.875rem', color: 'rgba(255,255,255,0.7)', marginBottom: '1.5rem' }}>
            States scored out of 100 based on conversion rate (target: 50%) and velocity (target: 30 days). Equal weighting. Last 6 months.
          </div>
          
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2rem' }}>
            {/* Top Performers */}
            <div>
              <h4 style={{ color: '#4BD48D', marginBottom: '1rem', fontSize: '1rem', fontWeight: '600' }}>
                🏆 Top Performers
              </h4>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                {(metrics?.topStates || []).map((state, index) => (
                  <div key={index} style={{ 
                    background: 'rgba(75, 212, 141, 0.1)', 
                    borderLeft: '4px solid #4BD48D',
                    padding: '0.75rem 1rem',
                    borderRadius: '4px'
                  }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                      <span style={{ fontWeight: '600', fontSize: '1rem' }}>{state.state}</span>
                      <span style={{ 
                        fontSize: '1.5rem', 
                        fontWeight: '700',
                        color: parseFloat(state.stateScore) >= 100 ? '#4BD48D' : parseFloat(state.stateScore) >= 90 ? '#CFFB5E' : '#00BEA8'
                      }}>
                        {state.stateScore}
                      </span>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem', fontSize: '0.75rem', color: 'rgba(255,255,255,0.7)' }}>
                      <div>Conversion: {state.conversionRate}%</div>
                      <div>Velocity: {state.avgVelocity}d</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Bottom Performers */}
            <div>
              <h4 style={{ color: '#FF6B6B', marginBottom: '1rem', fontSize: '1rem', fontWeight: '600' }}>
                ⚠️ Needs Improvement
              </h4>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                {(metrics?.bottomStates || []).map((state, index) => (
                  <div key={index} style={{ 
                    background: 'rgba(255, 107, 107, 0.1)', 
                    borderLeft: '4px solid #FF6B6B',
                    padding: '0.75rem 1rem',
                    borderRadius: '4px'
                  }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                      <span style={{ fontWeight: '600', fontSize: '1rem' }}>{state.state}</span>
                      <span style={{ 
                        fontSize: '1.5rem', 
                        fontWeight: '700',
                        color: parseFloat(state.stateScore) < 70 ? '#FF6B6B' : parseFloat(state.stateScore) < 90 ? '#FFA500' : '#CFFB5E'
                      }}>
                        {state.stateScore}
                      </span>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem', fontSize: '0.75rem', color: 'rgba(255,255,255,0.7)' }}>
                      <div>Conversion: {state.conversionRate}%</div>
                      <div>Velocity: {state.avgVelocity}d</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
          
          {/* 12-Month Aggregate Trend */}
          <div style={{ marginTop: '2rem', paddingTop: '2rem', borderTop: '1px solid rgba(255,255,255,0.2)' }}>
            <h4 style={{ color: '#00BEA8', marginBottom: '0.5rem', fontSize: '1rem', fontWeight: '600' }}>
              📊 All States Aggregate Score - Trailing 12 Months
            </h4>
            <div style={{ fontSize: '0.75rem', color: 'rgba(255,255,255,0.6)', marginBottom: '1rem' }}>
              Excludes most recent 2 months to allow for conversion lag (90-day window)
            </div>
            <ResponsiveContainer width="100%" height={250}>
              <LineChart data={metrics?.conversionScoreTrend || []}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" />
                <XAxis 
                  dataKey="month" 
                  stroke="#E0E7FF" 
                  style={{ fontSize: '0.75rem' }}
                  angle={-45}
                  textAnchor="end"
                  height={80}
                />
                <YAxis 
                  stroke="#E0E7FF" 
                  label={{ value: 'Conversion Score', angle: -90, position: 'insideLeft', fill: '#E0E7FF' }}
                  domain={[80, 'auto']}
                />
                <Tooltip
                  contentStyle={{ backgroundColor: 'rgba(30, 27, 75, 0.95)', border: '1px solid rgba(255,255,255,0.2)', borderRadius: '8px' }}
                  labelStyle={{ color: '#E0E7FF' }}
                  itemStyle={{ color: '#FFFFFF' }}
                  formatter={(value, name) => {
                    if (name === 'score') return [value, 'Score'];
                    return [value, name];
                  }}
                />
                <Line 
                  type="monotone" 
                  dataKey="score" 
                  stroke="#00BEA8" 
                  strokeWidth={3} 
                  name="Aggregate Score"
                  dot={{ fill: '#00BEA8', r: 4 }}
                  activeDot={{ r: 6 }}
                />
                {/* Reference line at 100 (meeting standard) */}
                <Line 
                  type="monotone" 
                  dataKey={() => 100} 
                  stroke="#CFFB5E" 
                  strokeWidth={2} 
                  strokeDasharray="5 5"
                  name="Target (100)"
                  dot={false}
                />
              </LineChart>
            </ResponsiveContainer>
            <div style={{ fontSize: '0.75rem', color: 'rgba(255,255,255,0.6)', marginTop: '0.5rem', textAlign: 'center' }}>
              Dashed line shows target score of 100 (meeting standard)
            </div>
          </div>
        </div>


        {/* Application Trend - 3 Year Comparison */}
        <div className="chart-card chart-full">
          <h3 className="chart-title">Application Trend by Month (3 Year Comparison)</h3>
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={metrics?.monthlyTrend || []}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" />
              <XAxis dataKey="month" stroke="#E0E7FF" />
              <YAxis stroke="#E0E7FF" label={{ value: 'Applications', angle: -90, position: 'insideLeft', fill: '#E0E7FF' }} />
              <Tooltip
                contentStyle={{ backgroundColor: 'rgba(30, 27, 75, 0.95)', border: '1px solid rgba(255,255,255,0.2)', borderRadius: '8px' }}
                labelStyle={{ color: '#E0E7FF' }}
              />
              <Legend />
              <Line 
                type="monotone" 
                dataKey={metrics?.monthlyTrendMeta?.year1Label} 
                stroke="#4BD48D" 
                strokeWidth={3} 
                name={metrics?.monthlyTrendMeta?.year1Label || '2023'} 
                strokeDasharray="5 5"
              />
              <Line 
                type="monotone" 
                dataKey={metrics?.monthlyTrendMeta?.year2Label} 
                stroke="#00BEA8" 
                strokeWidth={3} 
                name={metrics?.monthlyTrendMeta?.year2Label || '2024'} 
              />
              <Line 
                type="monotone" 
                dataKey={metrics?.monthlyTrendMeta?.year3Label} 
                stroke="#CFFB5E" 
                strokeWidth={4} 
                name={metrics?.monthlyTrendMeta?.year3Label || '2025'} 
              />
            </LineChart>
          </ResponsiveContainer>
          <div className="cohort-note">
            <strong>Note:</strong> Shows each calendar month (Jan-Dec) compared across the last 3 years. 2026 data is incomplete as the year is still in progress.
          </div>
        </div>

        <div className="metrics-grid">
          <div className="metric-card">
            <div className="metric-header">
              <span className="metric-label">Top State (MTD)</span>
              <MapPin size={20} className="icon-blue" />
            </div>
            <div className="metric-value-small">{metrics?.topState?.name || 'N/A'}</div>
            <div className="metric-subtitle">{metrics?.topState ? `${metrics.topState.count} apps (${metrics.topState.percentage}%)` : 'No data'}</div>
          </div>

          <div className="metric-card">
            <div className="metric-header">
              <span className="metric-label">Enrollment Rate (Last 6 Months)</span>
              <TrendingUp size={20} className="icon-green" />
            </div>
            <div className="metric-value">{metrics?.enrollmentRate || 0}%</div>
            <div className="metric-subtitle">{metrics?.last6MonthsEnrolled || 0} enrolled of {metrics?.last6MonthsApps || 0} apps</div>
          </div>

          <div className="metric-card">
            <div className="metric-header">
              <span className="metric-label">Completion Rate (Last 2 Years)</span>
              <GraduationCap size={20} className="icon-purple" />
            </div>
            <div className="metric-value">{metrics?.completionRate || 0}%</div>
            <div className="metric-subtitle">{metrics?.last2YearsCompleted || 0} completed of {metrics?.last2YearsEnrolled || 0} enrolled</div>
          </div>
        </div>


        {/* State Performance Matrix */}
        <div className="chart-card chart-full" style={{ marginTop: '2rem' }} id="state-matrix">
          <h3 className="chart-title">State Performance Matrix (Last 6 Months)</h3>
          <div style={{ fontSize: '0.875rem', color: 'rgba(255,255,255,0.7)', marginBottom: '1.5rem' }}>
            States plotted by conversion rate (X-axis) and median velocity (Y-axis). Quadrants indicate strategic action.
          </div>
          
          <ResponsiveContainer width="100%" height={400}>
            <ScatterChart margin={{ top: 20, right: 100, bottom: 20, left: 20 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" />
              <XAxis 
                type="number" 
                dataKey="conversionRate" 
                name="Conversion Rate" 
                stroke="#E0E7FF"
                label={{ value: 'Conversion Rate (%)', position: 'bottom', fill: '#E0E7FF', offset: 0 }}
                domain={[0, 100]}
              />
              <YAxis 
                type="number" 
                dataKey="medianVelocity" 
                name="Median Velocity" 
                stroke="#E0E7FF"
                label={{ value: 'Median Velocity (days)', angle: -90, position: 'insideLeft', fill: '#E0E7FF' }}
                domain={[0, 'auto']}
                reversed
              />
              <Tooltip
                contentStyle={{ backgroundColor: 'rgba(30, 27, 75, 0.95)', border: '1px solid rgba(255,255,255,0.2)', borderRadius: '8px' }}
                labelStyle={{ color: '#E0E7FF' }}
                itemStyle={{ color: '#FFFFFF' }}
                cursor={{ strokeDasharray: '3 3' }}
                content={({ active, payload }) => {
                  if (active && payload && payload.length) {
                    const data = payload[0].payload;
                    return (
                      <div style={{ backgroundColor: 'rgba(30, 27, 75, 0.95)', border: '1px solid rgba(255,255,255,0.2)', borderRadius: '8px', padding: '10px' }}>
                        <div style={{ fontWeight: 'bold', marginBottom: '5px', color: '#FFFFFF' }}>{data.state}</div>
                        <div style={{ fontSize: '0.85rem', color: '#FFFFFF' }}>Conversion: {data.conversionRate}%</div>
                        <div style={{ fontSize: '0.85rem', color: '#FFFFFF' }}>Velocity: {data.medianVelocity} days</div>
                        <div style={{ fontSize: '0.85rem', color: '#FFFFFF' }}>Applications: {data.applied}</div>
                        <div style={{ fontSize: '0.85rem', marginTop: '5px', fontWeight: 'bold', color: '#CFFB5E' }}>{data.quadrant}</div>
                      </div>
                    );
                  }
                  return null;
                }}
              />
              {/* Quadrant divider lines */}
              <ReferenceLine 
                y={30} 
                stroke="rgba(255,255,255,0.3)" 
                strokeWidth={2} 
                strokeDasharray="5 5"
                label={{ value: 'Target: 30 days', position: 'right', fill: '#E0E7FF', fontSize: 12 }}
              />
              <ReferenceLine 
                x={50} 
                stroke="rgba(255,255,255,0.3)" 
                strokeWidth={2} 
                strokeDasharray="5 5"
                label={{ value: 'Target: 50%', position: 'top', fill: '#E0E7FF', fontSize: 12 }}
              />
              <Scatter 
                name="States" 
                data={metrics?.stateMatrixData || []} 
                fill="#8884d8"
              >
                {(metrics?.stateMatrixData || []).map((entry, index) => {
                  let color = '#00BEA8'; // Default
                  if (entry.quadrant === 'Scale') color = '#4BD48D';
                  else if (entry.quadrant === 'Operational upside') color = '#CFFB5E';
                  else if (entry.quadrant === 'Lead quality issue') color = '#FFA500';
                  else if (entry.quadrant === 'Structural risk') color = '#FF6B6B';
                  
                  return <Cell key={`cell-${index}`} fill={color} />;
                })}
              </Scatter>
            </ScatterChart>
          </ResponsiveContainer>
          
          {/* Legend */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginTop: '1rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <div style={{ width: '16px', height: '16px', backgroundColor: '#4BD48D', borderRadius: '50%' }}></div>
              <span style={{ fontSize: '0.875rem' }}>Scale (High conv, Fast)</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <div style={{ width: '16px', height: '16px', backgroundColor: '#CFFB5E', borderRadius: '50%' }}></div>
              <span style={{ fontSize: '0.875rem' }}>Operational upside (High conv, Slow)</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <div style={{ width: '16px', height: '16px', backgroundColor: '#FFA500', borderRadius: '50%' }}></div>
              <span style={{ fontSize: '0.875rem' }}>Lead quality issue (Low conv, Fast)</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <div style={{ width: '16px', height: '16px', backgroundColor: '#FF6B6B', borderRadius: '50%' }}></div>
              <span style={{ fontSize: '0.875rem' }}>Structural risk (Low conv, Slow)</span>
            </div>
          </div>
        </div>


        {/* State MoM Enrollment Comparison */}
        <div className="mom-comparison-card">
          <h2 className="section-title">
            <TrendingUp size={20} />
            <span>State Enrollment Trends (Rolling 30 Days vs Prior 30 Days)</span>
          </h2>
          
          <div className="mom-comparison-grid">
            {/* Top Performers */}
            <div className="mom-column">
              <h3 className="mom-column-title mom-positive">📈 Top Performers</h3>
              <div className="mom-state-list">
                {(metrics?.topMoMStates || []).map((state, idx) => (
                  <div key={state.state} className="mom-state-item">
                    <div className="mom-state-rank">{idx + 1}</div>
                    <div className="mom-state-info">
                      <div className="mom-state-name">{state.state}</div>
                      <div className="mom-state-details">
                        {state.currentPeriod} enrollments ({state.change >= 0 ? '+' : ''}{state.change} from prior)
                      </div>
                    </div>
                    <div className={`mom-state-growth ${state.momGrowth >= 0 ? 'growth-positive' : 'growth-negative'}`}>
                      {state.momGrowth >= 0 ? '+' : ''}{state.momGrowth}%
                    </div>
                  </div>
                ))}
                {(!metrics?.topMoMStates || metrics.topMoMStates.length === 0) && (
                  <div className="mom-no-data">No data available</div>
                )}
              </div>
            </div>

            {/* Bottom Performers */}
            <div className="mom-column">
              <h3 className="mom-column-title mom-negative">📉 Needs Attention</h3>
              <div className="mom-state-list">
                {(metrics?.bottomMoMStates || []).map((state, idx) => (
                  <div key={state.state} className="mom-state-item">
                    <div className="mom-state-rank">{idx + 1}</div>
                    <div className="mom-state-info">
                      <div className="mom-state-name">{state.state}</div>
                      <div className="mom-state-details">
                        {state.currentPeriod} enrollments ({state.change >= 0 ? '+' : ''}{state.change} from prior)
                      </div>
                    </div>
                    <div className={`mom-state-growth ${state.momGrowth >= 0 ? 'growth-positive' : 'growth-negative'}`}>
                      {state.momGrowth >= 0 ? '+' : ''}{state.momGrowth}%
                    </div>
                  </div>
                ))}
                {(!metrics?.bottomMoMStates || metrics.bottomMoMStates.length === 0) && (
                  <div className="mom-no-data">No data available</div>
                )}
              </div>
            </div>
          </div>
        </div>


        <div className="chart-card chart-full">
          <h3 className="chart-title">Hired Candidate Comparison</h3>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={metrics?.semesterComparison || []}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" />
              <XAxis dataKey="term" stroke="#E0E7FF" angle={-45} textAnchor="end" height={80} />
              <YAxis stroke="#E0E7FF" label={{ value: 'Hired Count', angle: -90, position: 'insideLeft', fill: '#E0E7FF' }} />
              <Tooltip
                contentStyle={{ backgroundColor: 'rgba(30, 27, 75, 0.95)', border: '1px solid rgba(255,255,255,0.2)', borderRadius: '8px' }}
                labelStyle={{ color: '#E0E7FF' }}
                itemStyle={{ color: '#FFFFFF' }}
              />
              <Legend 
                payload={[
                  { value: 'Spring', type: 'square', color: '#00BEA8' },
                  { value: 'Fall', type: 'square', color: '#CFFB5E' }
                ]}
              />
              <Bar dataKey="enrolled" name="Hired Count">
                {(metrics?.semesterComparison || []).map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={entry.termOnly === 'Spring' ? '#00BEA8' : '#CFFB5E'} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
};

export default EnrollmentDashboard;
