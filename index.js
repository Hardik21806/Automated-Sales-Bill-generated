// Utility function to shuffle an array (Fisher-Yates algorithm)
function shuffleArray(array) {
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
    }
}

function calculateItemTotal(price, qty, gstPercent, cessPercent, mrp) {
    const base = price * qty;
    const gstTax = (base * gstPercent) / 100;
    const cessTax = ((mrp || 0) * qty * (cessPercent || 0)) / 100;
    return +(base + gstTax + cessTax).toFixed(2);
}

function buildStockMap(data) {
    const map = new Map();
    for (const item of data) {
        const key = item["Item Details"];
        map.set(key, {
            ...item,
            remainingQty: item["Qty."]
        });
    }
    return map;
}

/** ======== Bill Generation Logic ======== */
let lastStartIndex = 0;
let billCounter = 0;

function getMinMaxItemsByTarget(targetAmount) {
    if (targetAmount < 1000) return [2, 3];
    if (targetAmount < 5000) return [3, 5];
    return [5, 7];
}

function generateBillFromMap(stockMap, targetAmount, date, margin = 5) {
    billCounter++;

    const RESET_INTERVAL = 5; // every 5 bills
    // Filter out items where the unit price is extremely low, 
    // to help meet the minimum contribution.
    const MIN_UNIT_PRICE = 50; 
    
    const allItems = Array.from(stockMap.entries())
        .filter(([_, item]) => item.remainingQty > 0 && item["Price"] >= MIN_UNIT_PRICE)
        .sort((a, b) => b[1]["Amount"] - a[1]["Amount"]);

    const itemCount = allItems.length;

    if (billCounter % RESET_INTERVAL === 0 && lastStartIndex > 0) {
        // Randomly jump back a bit
        lastStartIndex = Math.floor(Math.random() * lastStartIndex);
    }

    let startIndex = lastStartIndex % itemCount;

    if (itemCount === 0) return { items: [], total: 0, success: false };

    // Decide how many items to try for this bill
    const [minItemsOriginal, maxItems] = getMinMaxItemsByTarget(targetAmount);
    
    // ENFORCING MINIMUM 3 ITEMS:
    const minItems = Math.max(3, minItemsOriginal); 
    
    // Ensure maxItems is not less than the new minItems (3)
    const finalMaxItems = Math.max(minItems, maxItems);

    const expectedItems = Math.floor(Math.random() * (finalMaxItems - minItems + 1)) + minItems;
    lastStartIndex += expectedItems; // update global for next call

    const result = [];
    let total = 0;
    let remainingTarget = targetAmount;

    let looped = false;
    let pickedCount = 0;

    const maxLoopIterations = itemCount * 2; 
    let iterationCount = 0;

    while (pickedCount < expectedItems && !looped && iterationCount < maxLoopIterations) {
        const [productName, item] = allItems[startIndex];
        iterationCount++;

        if (item.remainingQty <= 0) {
            startIndex = (startIndex + 1) % itemCount;
            looped = (startIndex === 0);
            continue;
        }

        const unitPrice = item["Price"];
        const gstPercent = item["GST PERCENT"] || 0;
        const cessPercent = item["CESS%"] || 0;
        const mrp = item["MRP"] || 0;
        const maxQty = item.remainingQty;
        const idealContribution = remainingTarget / (expectedItems - result.length);

        let qty = 1;
        let selectedQty = 0;

        // NEW LOGIC: Enforce a minimum contribution per item
        const MIN_ITEM_CONTRIBUTION = 200;
        const minContributionForThisItem = Math.min(MIN_ITEM_CONTRIBUTION, remainingTarget);
        
        // Calculate the minimum quantity needed to meet the minimum contribution
        const minQtyToMeetContribution = Math.ceil(minContributionForThisItem / unitPrice);
        
        // Start checking quantity from the minimum required to meet the contribution
        qty = Math.max(1, minQtyToMeetContribution);


        while (qty <= maxQty) {
            const itemTotal = calculateItemTotal(unitPrice, qty, gstPercent, cessPercent, mrp);
            
            // 1. Hard stop if the item pushes the bill over budget plus margin
            if (total + itemTotal > targetAmount + margin) break;
            
            // 2. Prefer quantities where the total contribution is less than or around the ideal share.
            if (itemTotal <= idealContribution * 1.5 || result.length === 0) {
                 selectedQty = qty;
            } else {
                 break; 
            }
            qty++;
        }
        
        let finalQty = selectedQty;
        if (finalQty > 0) {
            let finalItemTotal = calculateItemTotal(unitPrice, finalQty, gstPercent, cessPercent, mrp);
            
            // Re-check: Ensure the final item total contributes at least the minimum, unless it's the last item and remaining target is low.
            if (finalItemTotal < minContributionForThisItem && result.length < expectedItems - 1) {
                // If the selected quantity is too low and it's not the final item, skip or increase Qty.
                finalQty = 0; // Skip this item this cycle
            }

            // Safety break if one item satisfies the whole bill (shouldn't happen with the new logic, but helps prevent overshoot)
            if (finalQty === 1 && total + finalItemTotal > targetAmount + margin) {
                finalQty = 0; 
            } else if (total + finalItemTotal > targetAmount + margin) {
                if (finalQty > 1) {
                    finalQty -= 1;
                    finalItemTotal = calculateItemTotal(unitPrice, finalQty, gstPercent, cessPercent, mrp);
                } else {
                    finalQty = 0;
                }
            }
        
            if (finalQty > 0) {
                const cessTaxAmount = ((mrp || 0) * finalQty * (cessPercent || 0)) / 100;
                result.push({
                    name: productName,
                    qty: finalQty,
                    unitPrice,
                    gstPercent,
                    cessPercent,
                    mrp,
                    cessTaxAmount,
                    itemTotal: finalItemTotal,
                    date,
                });

                total += finalItemTotal;
                remainingTarget -= finalItemTotal;
                item.remainingQty -= finalQty;
                item.Amount = +(item.remainingQty * unitPrice).toFixed(2);
                stockMap.set(productName, item);
                pickedCount++;
            }
        }


        startIndex = (startIndex + 1) % itemCount;
        if (startIndex === 0) {
            looped = true; 
            // The check below still uses the minimum number of items derived from the target amount
            if (result.length < minItems && Math.abs(total - targetAmount) > targetAmount * 0.1) {
                looped = false; 
            }
        }
    }

    return {
        items: result,
        total: +total.toFixed(2),
        targetAmount,
    };
}
/** ======== End Bill Generation Logic ======== */

function exportUpdatedStockToXLSX(stockMap, filename = "updated-stock.xlsx") {
    const updatedStock = [];

    for (const [_, item] of stockMap.entries()) {
        updatedStock.push({
            "Item Details": item["Item Details"],
            "Parent Group": item["Parent Group"],
            "Qty.": item.remainingQty, // Use updated remaining quantity
            "Unit": item["Unit"],
            "SALES PRICE": item["SALES PRICE"],
            "HSN CODE": item["HSN CODE"],
            "GST PERCENT": item["GST PERCENT"],
            "CESS%": item["CESS%"] || 0,
            "MRP": item["MRP"] || 0,
            "Price": item["Price"],
            "Amount": +(item.remainingQty * item["Price"]).toFixed(2), // Recalculate Amount
        });
    }

    const ws = XLSX.utils.json_to_sheet(updatedStock);

    const headers = Object.keys(updatedStock[0]);

    const defaultWidth = 15;
    ws['!cols'] = headers.map(() => ({ wch: defaultWidth }))
    ws['!cols'][0] = { wch: 40 }; // Wider column for Item Name

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, ws, "Stock");

    XLSX.writeFile(workbook, filename);
}

function generateBillNumber(index, prefix = "BILL", padLength = 4) {
    const paddedIndex = String(index).padStart(padLength, '0');
    return `${prefix}${paddedIndex}`;
}

// Global counter for cycling through purchaser names
let purchaserIndexCounter = 0;

function exportBillsToExcel(bills, filename = "generated-bills.xlsx", billPrefixId, billIndexId, paymentMethod) {
    const prefix = document.getElementById(billPrefixId).value || "BILL";
    const startIndex = parseInt(document.getElementById(billIndexId).value, 10) || 1;
    const rows = [];
    
    // Create a list of names to cycle through for cash bills
    // Note: UPI bills (which use this function too) won't have purchaser data, so we only use the global list if it's populated.
    const namesToAssign = purchaserNames.length > 0 && paymentMethod === "Cash" ? [...purchaserNames] : ['N/A'];
    
    // START FIX: Shuffle the purchaser names list for true randomness
    if (paymentMethod === "Cash" && namesToAssign.length > 1) {
        shuffleArray(namesToAssign);
    }
    // END FIX

    const totalNames = namesToAssign.length;
    
    // Reset counter for a fresh generation
    purchaserIndexCounter = 0;
    
    bills.forEach((bill, index) => {
        // Assign a name to the entire bill
        // This cycles through the shuffled list
        const billPurchaserName = namesToAssign[purchaserIndexCounter % totalNames];
        purchaserIndexCounter++;
        
        // Calculate Round Off for the bill (only if Cash)
        let roundOff = 0;
        let finalBillTotal = bill.total;
        
        if (paymentMethod === "Cash") {
            const roundedTotal = Math.round(bill.total);
            roundOff = +(roundedTotal - bill.total).toFixed(2);
            finalBillTotal = roundedTotal;
        }

        bill.items.forEach(item => {
            const billNo = generateBillNumber(index + startIndex, prefix);
            const taxAmount = item.itemTotal - (item.unitPrice * item.qty) - (item.cessTaxAmount || 0);
            rows.push({
                "Bill No": billNo,
                "Purchaser Name": billPurchaserName, 
                "Payment Method": paymentMethod, 
                "Item Name": item.name,
                "Quantity": item.qty,
                "Unit Price": item.unitPrice,
                "Item Price": +(item.unitPrice * item.qty).toFixed(2),
                "GST %": item.gstPercent,
                "SGST": (item.gstPercent / 2).toFixed(2),
                "Total SGST Amount": +(taxAmount / 2).toFixed(2),
                "CGST": (item.gstPercent / 2).toFixed(2),
                "Total CGST Amount": +(taxAmount / 2).toFixed(2),
                "Total Tax Amount": +(taxAmount).toFixed(2),
                "CESS %": item.cessPercent,
                "CESS Tax Amount": +(item.cessTaxAmount || 0).toFixed(2),
                "Date": item.date,
                "Item Total": item.itemTotal,
                "Bill Total (Unrounded)": bill.total,
                "Round off": roundOff, // NEW ROUND OFF COLUMN
                "Bill Total (Final)": finalBillTotal, // Show the final rounded total
                "Original Bill Amount": bill.targetAmount,
            });
        });
    });

    const ws = XLSX.utils.json_to_sheet(rows);

    // Create an array with same width for all columns
    const defaultWidth = 15; // You can adjust this
    const headers = Object.keys(rows[0]);
    ws['!cols'] = headers.map(() => ({ wch: defaultWidth }))
    ws['!cols'][2] = { wch: 20 }; // Wider column for Payment Method
    ws['!cols'][3] = { wch: 40 }; // Wider column for Item Name (now column 4)
    ws['!cols'][1] = { wch: 25 }; // Wider column for Purchaser Name (now column 2)

    // Continue with workbook creation
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Bills");
    XLSX.writeFile(wb, filename);
}

// Function to format date from YYYY-MM-DD to DD/MM/YYYY
function formatDisplayDate(dateStr) {
    if (!dateStr || dateStr.length !== 10) return dateStr;
    const parts = dateStr.split('-');
    // Assuming YYYY-MM-DD format
    return `${parts[2]}/${parts[1]}/${parts[0]}`;
}


// Function to format date for use in filenames (existing logic)
function formatDate(dateInput) {
    const date = new Date(dateInput);

    const pad = num => String(num).padStart(2, '0');

    const dd = pad(date.getDate());
    const mm = pad(date.getMonth() + 1); // Months are 0-based
    const yyyy = date.getFullYear();
    const HH = pad(date.getHours());
    const MM = pad(date.getMinutes());
    const SS = pad(date.getSeconds());

    return `${dd}-${mm}-${yyyy}T${HH}-${MM}-${SS}`;
}


// Global State variables
let stockData = null; // UPI Bills Stock
let billTargets = null; // UPI Bills targets from file
let cashStockData = null; // Cash Bills Stock
let dateAmountTargets = []; // New state for date-specific targets
let purchaserNames = []; // NEW: Array to hold purchaser names

/**
 * Generates the interactive table of working dates (excluding Sunday) 
 * and stores the target amounts in the global dateAmountTargets array.
 */
function generateDateTable() {
    const startDateStr = document.getElementById("cashStartDate").value;
    const endDateStr = document.getElementById("cashEndDate").value;
    const tableContainer = document.getElementById("dateAmountTableContainer");

    if (!startDateStr || !endDateStr) {
        tableContainer.innerHTML = '';
        dateAmountTargets = [];
        updateGenerateCashButtonState();
        return;
    }

    const startDate = new Date(startDateStr);
    const endDate = new Date(endDateStr);
    const validDates = [];
    let currentDate = new Date(startDate);
    
    // Generate the list of valid dates (Mon-Sat)
    while (currentDate <= endDate) {
        // currentDate.getDay() returns 0 for Sunday
        if (currentDate.getDay() !== 0) { 
            // Format as 'YYYY-MM-DD'
            const dateStr = currentDate.toISOString().split('T')[0];
            validDates.push(dateStr);
        }
        currentDate.setDate(currentDate.getDate() + 1);
    }

    // Rebuild dateAmountTargets, retaining existing amounts if dates match
    const newDateAmountTargets = [];
    let tableHtml = '<table class="date-amount-table"><thead><tr><th>Date</th><th>Daily Target Amount (₹)</th></tr></thead><tbody>';
    let totalSum = 0;

    validDates.forEach(dateStr => {
        // Try to find if this date already existed in the previous array to keep the amount
        const existingTarget = dateAmountTargets.find(t => t.date === dateStr);
        const amount = existingTarget ? existingTarget.targetAmount : 0;
        
        newDateAmountTargets.push({ date: dateStr, targetAmount: amount });
        totalSum += amount;
        
        // Generate table row HTML, using formatDisplayDate for DD/MM/YYYY view
        tableHtml += `
            <tr>
                <td>${formatDisplayDate(dateStr)}</td>
                <td>
                    <input type="number" 
                           data-date="${dateStr}" 
                           class="daily-target-input"
                           min="0" 
                           value="${amount}"
                           placeholder="Enter amount">
                </td>
            </tr>
        `;
    });
    
    // Add the total sum row
    tableHtml += `
        <tr class="total-row">
            <td><strong>TOTAL SUM:</strong></td>
            <td><strong id="totalDailySum">${totalSum.toFixed(2)}</strong></td>
        </tr>
    `;
    
    tableHtml += '</tbody></table>';

    // Update the DOM and the global state
    tableContainer.innerHTML = tableHtml;
    dateAmountTargets = newDateAmountTargets;

    // Function to update the total sum displayed in the table
    function updateTableTotal() {
        let currentTotal = 0;
        dateAmountTargets.forEach(t => { currentTotal += t.targetAmount; });
        const totalElement = document.getElementById("totalDailySum");
        if (totalElement) {
            totalElement.textContent = currentTotal.toFixed(2);
        }
    }
    
    // Attach event listeners to the new input fields
    document.querySelectorAll('.daily-target-input').forEach(input => {
        input.oninput = function() {
            const date = this.dataset.date;
            const targetAmount = parseFloat(this.value) || 0;
            
            const target = dateAmountTargets.find(t => t.date === date);
            if (target) {
                target.targetAmount = targetAmount;
            }
            updateTableTotal();
            updateGenerateCashButtonState();
        };
    });

    updateGenerateCashButtonState();
}


function updateGenerateButtonState() {
    const btn = document.getElementById("generateBtn");
    btn.disabled = !(stockData && billTargets);
}

function updateGenerateCashButtonState() {
    const btn = document.getElementById("generateCashBtn");
    const minBill = document.getElementById("cashMinBill").value;
    const maxBill = document.getElementById("cashMaxBill").value;

    // Check if stock is uploaded, min/max bill ranges are set, 
    // AND if the date table is generated with at least one date, 
    // AND if ALL target amounts are greater than 0.
    const hasValidTargets = dateAmountTargets.length > 0 && 
                            dateAmountTargets.every(t => t.targetAmount > 0);
    
    // Require purchaser names file if there are targets
    const needsNames = dateAmountTargets.length > 0;
    const hasNames = purchaserNames.length > 0;
    
    // The button is disabled if required inputs are missing OR 
    // if targets exist but names are missing.
    btn.disabled = !(cashStockData && minBill && maxBill && hasValidTargets && (!needsNames || hasNames));
}

function tryGenerateAllBills() {
    if (!stockData || !billTargets) return;

    const stockMap = buildStockMap(stockData);
    const bills = [];

    for (const amountObj of billTargets) {
        const values = Object.values(amountObj);
        const target = parseFloat(values[0]);
        const date = values[1]; 
        
        if (isNaN(target) || !date) {
            console.warn("Skipping invalid bill target:", amountObj);
            continue;
        }
        
        const bill = generateBillFromMap(stockMap, target, date);
        if (bill?.items?.length > 0) {
            bills.push(bill);
        } else {
            console.warn("Failed to generate bill for:", target, "on date:", date);
        }
    }

    const today = formatDate(new Date());
    // PASSING "UPI" AS THE PAYMENT METHOD
    exportBillsToExcel(bills, `generated-upi-bills-${today}.xlsx`, "billPrefix", "startIndex", "UPI");
    exportUpdatedStockToXLSX(stockMap, `updated-upi-stock-${today}.xlsx`);
}

function handleStockFile(file) {
    const reader = new FileReader();
    reader.onload = function (evt) {
        const data = evt.target.result;
        const workbook = XLSX.read(data, { type: 'binary' });
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        stockData = XLSX.utils.sheet_to_json(sheet);
        updateGenerateButtonState();
    };
    reader.readAsBinaryString(file);
}

function handleBillAmountFile(file) {
    const reader = new FileReader();
    reader.onload = function (evt) {
        const data = evt.target.result;
        const workbook = XLSX.read(data, { type: 'binary' });
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        billTargets = XLSX.utils.sheet_to_json(sheet);
        updateGenerateButtonState();
    };
    reader.readAsBinaryString(file);
}

function handleCashStockFile(file) {
    const reader = new FileReader();
    reader.onload = function (evt) {
        const data = evt.target.result;
        const workbook = XLSX.read(data, { type: 'binary' });
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        cashStockData = XLSX.utils.sheet_to_json(sheet);
        updateGenerateCashButtonState();
    };
    reader.readAsBinaryString(file);
}

function handlePurchaserNamesFile(file) {
    const reader = new FileReader();
    reader.onload = function (evt) {
        const data = evt.target.result;
        const workbook = XLSX.read(data, { type: 'binary' });
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        
        // Assume names are in the first column of the sheet (index 0)
        // XLSX.utils.sheet_to_json converts the first row to keys. We need raw data.
        const sheetData = XLSX.utils.sheet_to_json(sheet, { header: 1 });
        
        if (sheetData.length > 1) {
             // Take the first column (index 0) and skip the header row (index 0)
            const firstColumnData = sheetData.slice(1).map(row => row[0]).filter(name => name);
            purchaserNames = firstColumnData.map(name => String(name).trim());
            
            if (purchaserNames.length === 0) {
                 alert("The names file was uploaded but contained no valid names in the first column.");
            }
        } else {
             purchaserNames = [];
             alert("The names file is empty or formatted incorrectly.");
        }
        
        updateGenerateCashButtonState();
    };
    reader.readAsBinaryString(file);
}

function tryGenerateCashBills() {
    let minBill = parseFloat(document.getElementById("cashMinBill").value);
    let maxBill = parseFloat(document.getElementById("cashMaxBill").value);
    
    if (!cashStockData || isNaN(minBill) || isNaN(maxBill) || minBill <= 0 || maxBill <= 0) {
        console.error("Missing or invalid input for Cash Bills generation.");
        return;
    }
    if (dateAmountTargets.length === 0 || dateAmountTargets.every(t => t.targetAmount <= 0)) {
        console.error("No valid daily target amounts provided.");
        alert("Please provide a target sales amount for each day in the table before generating bills.");
        return;
    }
    if (purchaserNames.length === 0) {
        console.error("No purchaser names provided.");
        alert("Please upload a file containing purchaser names.");
        return;
    }
    
    // Enforce min/max bill limits
    minBill = Math.max(minBill, 100); // Basic floor
    maxBill = Math.min(maxBill, 99000); // Basic ceiling
    if (minBill > maxBill) {
        alert("Minimum bill amount cannot be greater than maximum bill amount. Please check the Bill Total Range.");
        return;
    }

    const stockMap = buildStockMap(cashStockData);
    const allGeneratedBills = [];

    // Iterate through the user-defined daily sales targets
    for (const { date, targetAmount } of dateAmountTargets) {
        if (targetAmount <= 0) continue; 

        let dateAccumulated = 0;
        
        // Loop until the daily target is met or slightly exceeded
        while (dateAccumulated < targetAmount) {
            // Determine the target size for the next individual bill
            let targetBillSize = Math.floor(Math.random() * (maxBill - minBill + 1)) + minBill;

            // Check if adding this bill size would wildly exceed the remaining daily target
            const remaining = targetAmount - dateAccumulated;
            
            // If the random target is larger than the remaining amount, try a smaller bill size 
            // or use the remaining amount as the target, but only if remaining is > minBill
            if (targetBillSize > remaining) {
                if (remaining >= minBill) {
                    targetBillSize = Math.max(minBill, remaining);
                } else if (remaining < minBill && remaining > 100) {
                    // Try to generate a small bill to finish the day
                    targetBillSize = remaining;
                } else {
                    // If remaining is too small, stop generating for this date
                    break; 
                }
            }
            
            // Generate the bill using the calculated target size
            const bill = generateBillFromMap(stockMap, targetBillSize, date, 15); // Use a larger margin for flexibility
            
            if (bill?.items?.length > 0) {
                allGeneratedBills.push(bill);
                dateAccumulated += bill.total;
            } else {
                // If a bill can't be generated (e.g., out of stock), break the day's loop
                console.warn(`Could not generate bill for target ${targetBillSize} on ${date}. Stock might be depleted.`);
                break;
            }
        }
    }

    const today = formatDate(new Date());
    // PASSING "Cash" AS THE PAYMENT METHOD
    exportBillsToExcel(allGeneratedBills, `cash-bills-${today}.xlsx`, "cashStockPrefix", "cashBillStartIndex", "Cash");
    exportUpdatedStockToXLSX(stockMap, `updated-cash-stock-${today}.xlsx`);
}

// attach event listeners after DOM is loaded
document.addEventListener("DOMContentLoaded", () => {
    const stockInput = document.getElementById("stockInput");
    const billInput = document.getElementById("billInput");
    const generateBtn = document.getElementById("generateBtn");
    const cashStockInput = document.getElementById("cashStockInput");
    const generateCashBtn = document.getElementById("generateCashBtn");
    const cashStartDateInput = document.getElementById("cashStartDate");
    const cashEndDateInput = document.getElementById("cashEndDate");
    const purchaserNamesInput = document.getElementById("purchaserNamesInput"); // NEW INPUT

    // UPI Bills listeners
    stockInput.onchange = e => handleStockFile(e.target.files[0]);
    billInput.onchange = e => handleBillAmountFile(e.target.files[0]);
    generateBtn.onclick = tryGenerateAllBills;

    // Cash Bills listeners
    
    // Generate table when dates change
    cashStartDateInput.onchange = generateDateTable;
    cashEndDateInput.onchange = generateDateTable;

    // Update button state when min/max bills change
    ["cashMinBill", "cashMaxBill"].forEach(id => {
        document.getElementById(id).oninput = updateGenerateCashButtonState;
    });

    // Handle file uploads
    cashStockInput.onchange = e => {
        handleCashStockFile(e.target.files[0]);
    };
    purchaserNamesInput.onchange = e => { // NEW HANDLER
        handlePurchaserNamesFile(e.target.files[0]);
    };
    
    generateCashBtn.onclick = tryGenerateCashBills;

    // Initial state updates
    updateGenerateButtonState();
    updateGenerateCashButtonState();

    // Simple tab switching logic
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.onclick = function () {
            document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            document.querySelectorAll('.tab-content').forEach(tc => tc.classList.remove('active'));
            document.getElementById('tab-' + btn.dataset.tab).classList.add('active');
        };
    });
});