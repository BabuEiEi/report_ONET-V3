/**
 * O-NET Management System (Clean Data Version)
 * Developer: Phattaraphon Kaewsena
 */

const SPREADSHEET_ID = 'ใส่ ID Google Sheet ที่เป็น Database'; 

const SHEETS = {
  USERS: 'Users',
  SCHOOL_INFO: 'SchoolInfo',
  FIELD: 'FieldDetails',
  ROOM: 'RoomDetails',
  BUDGET: 'BudgetDetails',
  DOCUMENTS: 'Documents',
  SETTINGS: 'Setting'
};

function doGet() {
  return HtmlService.createTemplateFromFile('index')
    .evaluate()
    .setTitle('ระบบบริหารจัดการการสอบ O-NET สพม.พิษณุโลก อุตรดิตถ์')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

function getDB() {
  try {
    if (SPREADSHEET_ID && SPREADSHEET_ID !== 'ใส่ ID Google Sheet ที่เป็น Database') {
      return SpreadsheetApp.openById(SPREADSHEET_ID);
    }
    return SpreadsheetApp.getActiveSpreadsheet();
  } catch (e) {
    throw new Error("ไม่สามารถเชื่อมต่อ Google Sheet ได้ (ตรวจสอบ ID)");
  }
}

// --- API HANDLING ---
function apiHandleRequest(request) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) {
    return JSON.stringify({ status: 'error', message: 'ระบบกำลังทำงานหนัก กรุณาลองใหม่' });
  }
  
  try {
    const ss = getDB();
    const action = request.action;
    const data = request.data;
    
    // 1. LOGIN
    if (action === 'login') {
      const usersSheet = ss.getSheetByName('Users') || ss.getSheetByName(SHEETS.USERS);
      if(!usersSheet) throw new Error("ไม่พบ Sheet Users");
      
      const rows = usersSheet.getDataRange().getValues();
      const headers = rows.shift().map(h => String(h).toLowerCase().trim());
      
      const uIdx = headers.indexOf('username');
      const pIdx = headers.indexOf('password');
      
      const foundRow = rows.find(row => 
        row[uIdx] && String(row[uIdx]).trim() !== "" && // Username ต้องไม่ว่าง
        String(row[uIdx]) === String(data.username) && 
        String(row[pIdx]) === String(data.password)
      );

      if (foundRow) {
        let rObj = {};
        headers.forEach((h, k) => rObj[h] = foundRow[k]);
        
        if(String(rObj.status).toLowerCase() === 'inactive' || rObj.status === false) {
           return JSON.stringify({ status: 'error', message: 'บัญชีถูกระงับ' });
        }

        return JSON.stringify({ 
          status: 'success', 
          user: {
            id: rObj.id,
            role: rObj.role,
            ref_id: rObj.ref_id,
            name: rObj.display_name || rObj.username
          } 
        });
      }
      return JSON.stringify({ status: 'error', message: 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง' });
    }

    // 2. DASHBOARD
    if (action === 'getDashboard') {
      return getDashboardData(ss);
    }

    // 3. CRUD GENERIC
    let sheetName = request.sheetName;
    if(sheetName === 'Settings') sheetName = 'Setting';
    if(sheetName === 'Budget') sheetName = 'BudgetDetails';

    let sheet = ss.getSheetByName(sheetName);
    if(!sheet) throw new Error("Sheet not found: " + sheetName);

    if (action === 'read') {
      const rows = sheet.getDataRange().getValues();
      const headers = rows.shift().map(h => String(h).toLowerCase().trim());
      
      // ✅ STRICT FILTER: กำหนดคีย์หลักของแต่ละ Sheet
      let primaryKey = 'id';
      if(headers.includes('username')) primaryKey = 'username';       // Users
      else if(headers.includes('school_id')) primaryKey = 'school_id'; // SchoolInfo, Field, Budget
      else if(headers.includes('doc_id')) primaryKey = 'doc_id';       // Documents
      else if(headers.includes('setting_key')) primaryKey = 'setting_key'; // Setting

      const pkIndex = headers.indexOf(primaryKey);

      const cleanResult = rows.map((r, i) => {
        // เงื่อนไข: ถ้าหาคีย์หลักเจอ และค่าในคีย์หลักเป็นค่าว่าง -> ถือเป็นแถวขยะ ให้ตัดทิ้ง
        if (pkIndex !== -1 && (!r[pkIndex] || String(r[pkIndex]).trim() === "")) return null;
        
        // Fallback: ถ้าไม่มีคีย์หลัก ให้เช็คว่าทั้งแถวว่างเปล่าหรือไม่
        const hasData = r.some(cell => String(cell).trim() !== "");
        if (!hasData) return null;

        let obj = { _rowIndex: i + 2 }; 
        headers.forEach((h, colIndex) => obj[h] = r[colIndex]);
        return obj;
      }).filter(item => item !== null); // กรองค่า null ออก

      return JSON.stringify({ status: 'success', data: cleanResult });
    }
    
    // --- CREATE ---
    if (action === 'create') {
      const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0]
                           .map(h => String(h).toLowerCase().trim());
      
      // ✅ ปรับปรุง: ตรวจสอบและบังคับ Format เป็น Text สำหรับเบอร์โทร
      const newRow = headers.map(header => {
         let val = data[header] || '';
         // ถ้าเป็นช่องเบอร์โทร และมีค่า ให้เติม ' นำหน้า
         if ((header === 'director_phone' || header === 'coord_phone') && val !== '') {
             return "'" + val;
         }
         return val;
      });

      sheet.appendRow(newRow);
      return JSON.stringify({ status: 'success', message: 'บันทึกสำเร็จ' });
    }

    // --- UPDATE ---
    if (action === 'update') {
      const rows = sheet.getDataRange().getValues();
      const headers = rows[0].map(h => String(h).toLowerCase().trim());
      
      let keyField = 'id';
      if(headers.includes('username')) keyField = 'username';
      else if(headers.includes('school_id')) keyField = 'school_id';
      else if(headers.includes('doc_id')) keyField = 'doc_id';
      else if(headers.includes('setting_key')) keyField = 'setting_key';

      const updateKey = data[keyField]; 
      const keyIndex = headers.indexOf(keyField);
      
      let rowIndex = -1;
      for(let i=1; i<rows.length; i++){
        if(String(rows[i][keyIndex]) === String(updateKey)) { rowIndex = i + 1; break; }
      }
      
      if(rowIndex > -1) {
        const currentData = rows[rowIndex-1];
        
        // ✅ ปรับปรุง: ตรวจสอบและบังคับ Format เป็น Text สำหรับเบอร์โทร
        const updateRow = headers.map((header, i) => {
            let val = data[header] !== undefined ? data[header] : currentData[i];
            
            // ถ้าเป็นช่องเบอร์โทร และมีค่า
            if ((header === 'director_phone' || header === 'coord_phone') && val !== '') {
                // เช็คก่อนว่ามี ' หรือยัง ถ้าไม่มีให้เติม
                if (String(val).charAt(0) !== "'") {
                    return "'" + val;
                }
            }
            return val;
        });

        sheet.getRange(rowIndex, 1, 1, sheet.getLastColumn()).setValues([updateRow]);
        return JSON.stringify({ status: 'success', message: 'อัปเดตสำเร็จ' });
      } else {
        return apiHandleRequest({ ...request, action: 'create' });
      }
    }

    if (action === 'delete') {
       const rows = sheet.getDataRange().getValues();
       const headers = rows[0].map(h => String(h).toLowerCase().trim());
       let keyField = 'id';
       if(headers.includes('username')) keyField = 'username';
       else if(headers.includes('school_id')) keyField = 'school_id';
       else if(headers.includes('doc_id')) keyField = 'doc_id';
       else if(headers.includes('setting_key')) keyField = 'setting_key';

       const deleteKey = request.id;
       const keyIndex = headers.indexOf(keyField);

       for(let i=1; i<rows.length; i++){
         if(String(rows[i][keyIndex]) === String(deleteKey)) {
           sheet.deleteRow(i + 1);
           return JSON.stringify({ status: 'success', message: 'ลบข้อมูลสำเร็จ' });
         }
       }
       throw new Error("Data not found");
    }

  } catch (e) {
    return JSON.stringify({ status: 'error', message: e.toString() });
  } finally {
    lock.releaseLock();
  }
}

// --- API: Get School Budget Bundle (สำหรับ School View) ---
function apiGetSchoolBudgetBundle(schoolId) {
  const ss = getDB();
  const budgetData = getRowDataBySchoolId(ss, 'BudgetDetails', schoolId);
  const fieldData = getRowDataBySchoolId(ss, 'FieldDetails', schoolId);
  
  return JSON.stringify({
    status: 'success',
    data: {
      budget: budgetData || {},
      field: fieldData || {}
    }
  });
}

// Helper Function
function getRowDataBySchoolId(ss, sheetName, schoolId) {
  const sheet = ss.getSheetByName(sheetName);
  if (!sheet) return null;
  const data = sheet.getDataRange().getValues();
  if (data.length < 2) return null;
  const headers = data.shift().map(h => String(h).toLowerCase().trim());
  const idIndex = headers.indexOf('school_id');
  if (idIndex === -1) return null;
  const foundRow = data.find(r => String(r[idIndex]) === String(schoolId));
  if (foundRow) {
    let obj = {};
    headers.forEach((h, i) => obj[h] = foundRow[i]);
    return obj;
  }
  return null;
}

function getDashboardData(ss) {
  const userSheet = ss.getSheetByName('Users');
  const uData = userSheet.getDataRange().getValues();
  const uHeaders = uData.shift().map(h => String(h).toLowerCase().trim());
  const h = {};
  uHeaders.forEach((col, i) => h[col] = i);
  
  const schools = uData
    .filter(r => r[h['role']] === 'school' && r[h['username']]) // เพิ่มเช็ค username ต้องไม่ว่าง
    .map(r => ({
      id: r[h['ref_id']], 
      name: r[h['display_name']] || ('โรงเรียน ' + r[h['ref_id']]),
      ref_id: r[h['ref_id']]
    }));
  
  const getIds = (possibilities) => {
    for (let name of possibilities) {
       let sheet = ss.getSheetByName(name);
       if(sheet) {
         let data = sheet.getDataRange().getValues();
         if(data.length <= 1) return [];
         let headers = data.shift().map(val => String(val).toLowerCase().trim());
         let idx = headers.indexOf('school_id');
         if(idx === -1) return [];
         return [...new Set(data.map(r => String(r[idx])).filter(v => v && v.trim() !== ''))];
       }
    }
    return [];
  };

  const checkList = {
    info: getIds(['SchoolInfo']),
    field: getIds(['FieldDetails']),
    room: getIds(['RoomDetails']),
    budget: getIds(['BudgetDetails', 'Budget'])
  };
  
  return JSON.stringify({ status: 'success', data: { schools: schools, checks: checkList } });
}
