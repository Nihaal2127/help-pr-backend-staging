const ExcelJS = require('exceljs');
const path = require('path');

async function createExcel({ 
    headers,       // Array of header names, e.g., ['Order ID', 'Product Name']
    data,          // Array of rows, e.g., [{ orderId: 1, productName: 'Product A' }]
    sheetName = 'Sheet1', // Name of the Excel sheet
    fileName = 'report.xlsx', // Default file name for download
}) {
    try {
        const workbook = new ExcelJS.Workbook();
        const worksheet = workbook.addWorksheet(sheetName);

        // Add headers
        worksheet.columns = headers.map(header => ({
            header, // Display name in Excel
            key: header.toLowerCase().replace(/ /g, '_'), // Unique key based on header
            width: 20, // Optional column width
        }));

        // Add data
        data.forEach(item => worksheet.addRow(item));

        // Generate Excel file in memory
        const fileBuffer = await workbook.xlsx.writeBuffer();

        return { fileBuffer, fileName };
    } catch (error) {
        console.error('Error creating Excel file:', error);
        throw new Error('Failed to generate Excel report');
    }
}

module.exports = createExcel;
