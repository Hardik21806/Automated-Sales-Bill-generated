// ==========================================
// 1. UTILITY FUNCTIONS
// ==========================================

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

function calculateTotalStockValue(data, displayElementId) {
    let totalValue = 0;
    data.forEach(item => {
        const qty = parseFloat(item["Qty."]) || 0;
        const price = parseFloat(item["Price"]) || 0;
        totalValue += (qty * price);
    });
    const displayEl = document.getElementById(displayElementId);
    if (displayEl) {
        displayEl.textContent = `Total Available Stock: ₹ ${totalValue.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    }
}

function waitFrame() {
    return new Promise(resolve => setTimeout(resolve, 0));
}

function buildStockMap(data) {
    const map = new Map();
    for (const item of data) {
        const key = item["Item Details"];
        const qty = Number(item["Qty."]) || 0;
        
        // CHECK: Is the input quantity a fraction? (e.g., 1.5)
        const isInputFloat = Math.abs(qty % 1) > 0.0001;

        map.set(key, {
            ...item,
            remainingQty: qty,
            originalIsFloat: isInputFloat, // Store this for later checks
            singleUnitCost: calculateItemTotal(Number(item["Price"]), 1, Number(item["GST PERCENT"]), Number(item["CESS%"]), Number(item["MRP"])),
            "Price": Number(item["Price"]) || 0,
            "GST PERCENT": Number(item["GST PERCENT"]) || 0,
            "CESS%": Number(item["CESS%"]) || 0,
            "MRP": Number(item["MRP"]) || 0
        });
    }
    return map;
}

function getItemBillTotal(item, qty) {
    return calculateItemTotal(
        item["Price"],
        qty,
        item["GST PERCENT"] || 0,
        item["CESS%"] || 0,
        item["MRP"] || 0
    );
}

// STRICT FLOAT LOGIC
function canSellInFloat(item) {
    if (item["MRP"] > 10000) return true;
    if (item.originalIsFloat) return true;
    return false;
}

// ==========================================
// 2. CORE GENERATOR LOGIC
// ==========================================

let billCounter = 0;

async function generateBillFromMap(stockMap, targetMin, targetMax, dayTotalRemaining, date, margin = 5, mode = 'RANGE', currentFailures = 0, dailyUsedItemIds = new Set()) {
    billCounter++;
    
    let availableItems = Array.from(stockMap.values())
        .filter(item => item.remainingQty > 0.001); 
        
    let freshItems = availableItems.filter(item => !dailyUsedItemIds.has(item["Item Details"]));
    
    availableItems.sort((a, b) => a.singleUnitCost - b.singleUnitCost);
    freshItems.sort((a, b) => a.singleUnitCost - b.singleUnitCost);

    const expensiveAll = [...availableItems].sort((a, b) => b.singleUnitCost - a.singleUnitCost);
    const expensiveFresh = [...freshItems].sort((a, b) => b.singleUnitCost - a.singleUnitCost);

    const itemCount = availableItems.length;
    if (itemCount === 0) return { items: [], total: 0, success: false, reason: "No items" };

    let effortMultiplier = 1.0;
    if (currentFailures > 50) effortMultiplier = 0.5;   
    if (currentFailures > 200) effortMultiplier = 0.1; 
    if (currentFailures > 400) effortMultiplier = 0.02; 

    const baseAttempts = [
        { count: 4, attempts: 50 },
        { count: 3, attempts: 50 },
        { count: 2, attempts: 100 }, 
        { count: 1, attempts: 20 }
    ];

    for (const tier of baseAttempts) {
        const minItems = tier.count;
        const maxAttempts = Math.max(1, Math.floor(tier.attempts * effortMultiplier));

        if (availableItems.length < minItems) continue;

        let minPossibleCost = 0;
        for(let i=0; i<minItems; i++) minPossibleCost += availableItems[i].singleUnitCost;

        if (minPossibleCost > targetMax && minPossibleCost > dayTotalRemaining) {
             // Continue
        }

        let selectionPool = [];

        for (let attempt = 0; attempt < maxAttempts; attempt++) {
            if (attempt % 50 === 0) await waitFrame();

            let useFreshPool = false;
            if (attempt < 2 && freshItems.length >= minItems) {
                useFreshPool = true;
            }

            if (useFreshPool) {
                if (attempt === 0) selectionPool = expensiveFresh; 
                else {
                    selectionPool = [...freshItems];
                    shuffleArray(selectionPool);
                }
            } else {
                if (attempt === 2) selectionPool = expensiveAll;
                else {
                    selectionPool = [...availableItems];
                    shuffleArray(selectionPool);
                }
            }

            let currentBill = [];
            let currentTotal = 0;
            let pickedCount = 0;
            let tempUsed = new Map();
            
            const getRem = (i) => {
                const used = tempUsed.get(i["Item Details"]) || 0;
                return Math.max(0, i.remainingQty - used);
            };

            for (const item of selectionPool) {
                if (currentTotal >= targetMin && pickedCount >= minItems) {
                     if (attempt === 0 || attempt === 2 || Math.random() > 0.5) break; 
                }
                
                const actualRemaining = getRem(item);
                if (actualRemaining <= 0.001) continue;

                const roomLeft = targetMax - currentTotal;
                if (roomLeft < 1) continue;

                const allowFloat = canSellInFloat(item);
                if (!allowFloat && item.singleUnitCost > roomLeft) continue;

                let maxQtyBudget = roomLeft / item.singleUnitCost;
                let absMax = Math.min(actualRemaining, maxQtyBudget);
                let qty = 0;

                if (allowFloat) {
                    if (absMax < 0.01) continue;
                    let factor = (attempt === 0 || attempt === 2) ? 0.9 : (Math.random() * 0.8 + 0.2);
                    qty = parseFloat((absMax * factor).toFixed(2));
                    if (pickedCount < minItems && qty > absMax / 2) {
                         qty = parseFloat((absMax / 2).toFixed(2));
                    }
                } else {
                    let intMax = Math.floor(absMax);
                    if (intMax < 1) continue;
                    if (pickedCount < minItems) intMax = Math.min(intMax, 2);
                    qty = Math.floor(Math.random() * intMax) + 1;
                }

                if (qty <= 0) continue;

                let cost = getItemBillTotal(item, qty);
                currentBill.push({ item, qty, cost });
                currentTotal += cost;
                pickedCount++;
                tempUsed.set(item["Item Details"], (tempUsed.get(item["Item Details"]) || 0) + qty);
            }

            let isValid = false;
            const tolerance = mode === 'EXACT' ? margin : 0;

            if (mode === 'RANGE') {
                if (currentTotal >= targetMin && currentTotal <= targetMax && pickedCount >= minItems) isValid = true;
            } else {
                 if (Math.abs(targetMax - currentTotal) <= tolerance && pickedCount >= minItems) isValid = true;
            }

            if (isValid) {
                const futureDayRemaining = dayTotalRemaining - currentTotal;
                
                if (futureDayRemaining <= margin || futureDayRemaining > 50) { 
                    const billData = formatResult(currentBill, currentTotal, targetMax, date);
                    billData.tempUsedMap = tempUsed;
                    return billData;
                }
            }
        }
    }
    return { items: [], total: 0, success: false };
}

function formatResult(billArray, total, target, date) {
    const finalItems = billArray.map(entry => {
        const cessTaxAmount = ((entry.item["MRP"] || 0) * entry.qty * (entry.item["CESS%"] || 0)) / 100;
        return {
            name: entry.item["Item Details"],
            qty: entry.qty,
            unitPrice: entry.item["Price"],
            gstPercent: entry.item["GST PERCENT"],
            cessPercent: entry.item["CESS%"],
            mrp: entry.item["MRP"],
            cessTaxAmount: cessTaxAmount,
            itemTotal: entry.cost,
            date: date
        };
    });
    return { items: finalItems, total: +total.toFixed(2), targetAmount: target, success: true };
}

// ==========================================
// 3. EXPORT & UI LOGIC
// ==========================================

function exportBillsToExcel(bills, filename, prefixId, indexId, paymentMethod) {
    const prefixElement = document.getElementById(prefixId);
    const indexElement = document.getElementById(indexId);
    const prefix = prefixElement ? prefixElement.value : "BILL";
    const startIndex = indexElement ? (parseInt(indexElement.value, 10) || 1) : 1;
    
    const rows = [];
    const namesToAssign = purchaserNames.length > 0 && paymentMethod === "Cash" ? [...purchaserNames] : ['N/A'];
    if (paymentMethod === "Cash" && namesToAssign.length > 1) shuffleArray(namesToAssign);
    
    let purchaserIndexCounter = 0;
    const totalNames = namesToAssign.length;
    
    bills.forEach((bill, index) => {
        let billPurchaserName = bill.purchaserName;
        if (!billPurchaserName) {
             billPurchaserName = namesToAssign[purchaserIndexCounter % totalNames];
             purchaserIndexCounter++;
        }
        
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
            
            // Calculate CGST and SGST
            const gstRate = item.gstPercent || 0;
            const cgstRate = gstRate / 2;
            const sgstRate = gstRate / 2;
            const cgstAmount = taxAmount / 2;
            const sgstAmount = taxAmount / 2;

            rows.push({
                "Bill No": billNo,
                "Purchaser Name": billPurchaserName, 
                "Payment Method": paymentMethod, 
                "Item Name": item.name,
                "Quantity": item.qty,
                "Unit Price": item.unitPrice,
                "Item Price": +(item.unitPrice * item.qty).toFixed(2),
                "GST %": gstRate,
                "CGST %": cgstRate,
                "CGST Amount": +(cgstAmount).toFixed(2),
                "SGST %": sgstRate,
                "SGST Amount": +(sgstAmount).toFixed(2),
                "Total Tax Amount": +(taxAmount).toFixed(2),
                "CESS Tax Amount": +(item.cessTaxAmount || 0).toFixed(2),
                "Date": formatDisplayDate(item.date),
                "Item Total": item.itemTotal,
                "Bill Total (Unrounded)": bill.total,
                "Round off": roundOff, 
                "Bill Total (Final)": finalBillTotal, 
            });
        });
    });

    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Bills");
    XLSX.writeFile(wb, filename);
}

function exportUpdatedStockToXLSX(stockMap, filename) {
    const updatedStock = [];
    for (const [_, item] of stockMap.entries()) {
        updatedStock.push({
            "Item Details": item["Item Details"],
            "Qty.": item.remainingQty, 
            "Unit": item["Unit"],
            "Price": item["Price"],
            "GST PERCENT": item["GST PERCENT"],
            "MRP": item["MRP"],
            "Amount": +(item.remainingQty * item["Price"]).toFixed(2),
        });
    }
    const ws = XLSX.utils.json_to_sheet(updatedStock);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Stock");
    XLSX.writeFile(wb, filename);
}

function generateBillNumber(index, prefix = "BILL", padLength = 4) {
    return `${prefix}${String(index).padStart(padLength, '0')}`;
}

function formatDisplayDate(dateStr) {
    if (!dateStr || dateStr.length !== 10) return dateStr;
    const parts = dateStr.split('-');
    return `${parts[2]}/${parts[1]}/${parts[0]}`;
}

function formatDate(dateInput) {
    const date = new Date(dateInput);
    const pad = num => String(num).padStart(2, '0');
    return `${pad(date.getDate())}-${pad(date.getMonth() + 1)}-${date.getFullYear()}T${pad(date.getHours())}-${pad(date.getMinutes())}`;
}

// Global State
let stockData = null; 
let billTargets = null; 
let cashStockData = null; 
let dateAmountTargets = []; 
let purchaserNames = []; 

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
    
    while (currentDate <= endDate) {
        if (currentDate.getDay() !== 0) { 
            const dateStr = currentDate.toISOString().split('T')[0];
            validDates.push(dateStr);
        }
        currentDate.setDate(currentDate.getDate() + 1);
    }

    const newDateAmountTargets = [];
    let tableHtml = '<table class="date-amount-table"><thead><tr><th>Date</th><th>Daily Target Amount (₹)</th></tr></thead><tbody>';
    let totalSum = 0;

    validDates.forEach(dateStr => {
        const existingTarget = dateAmountTargets.find(t => t.date === dateStr);
        const amount = existingTarget ? existingTarget.targetAmount : 0;
        newDateAmountTargets.push({ date: dateStr, targetAmount: amount });
        totalSum += amount;
        
        tableHtml += `
            <tr>
                <td>${formatDisplayDate(dateStr)}</td>
                <td>
                    <input type="number" data-date="${dateStr}" class="daily-target-input" min="0" value="${amount}">
                </td>
            </tr>
        `;
    });
    
    tableHtml += `
        <tr class="total-row">
            <td><strong>TOTAL SUM:</strong></td>
            <td><strong id="totalDailySum">${totalSum.toFixed(2)}</strong></td>
        </tr>
    `;
    
    tableHtml += '</tbody></table>';
    tableContainer.innerHTML = tableHtml;
    dateAmountTargets = newDateAmountTargets;

    document.querySelectorAll('.daily-target-input').forEach(input => {
        input.oninput = function() {
            const date = this.dataset.date;
            const targetAmount = parseFloat(this.value) || 0;
            const target = dateAmountTargets.find(t => t.date === date);
            if (target) target.targetAmount = targetAmount;
            
            let currentTotal = 0;
            dateAmountTargets.forEach(t => { currentTotal += t.targetAmount; });
            document.getElementById("totalDailySum").textContent = currentTotal.toFixed(2);
            updateGenerateCashButtonState();
        };
    });

    updateGenerateCashButtonState();
}

function updateGenerateButtonState() {
    const btn = document.getElementById("generateBtn");
    if(btn) btn.disabled = !(stockData && billTargets);
}

function updateGenerateCashButtonState() {
    const btn = document.getElementById("generateCashBtn");
    const minBill = document.getElementById("cashMinBill").value;
    const maxBill = document.getElementById("cashMaxBill").value;
    const hasValidTargets = dateAmountTargets.length > 0 && dateAmountTargets.some(t => t.targetAmount > 0);
    
    if(btn) btn.disabled = !(cashStockData && minBill && maxBill && hasValidTargets);
}

function handleStockFile(file) {
    const reader = new FileReader();
    reader.onload = evt => {
        const data = evt.target.result;
        const workbook = XLSX.read(data, { type: 'binary' });
        stockData = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]]);
        calculateTotalStockValue(stockData, "upiStockTotal"); 
        updateGenerateButtonState();
    };
    reader.readAsBinaryString(file);
}

function handleBillAmountFile(file) {
    const reader = new FileReader();
    reader.onload = evt => {
        const data = evt.target.result;
        const workbook = XLSX.read(data, { type: 'binary' });
        billTargets = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]]);
        updateGenerateButtonState();
    };
    reader.readAsBinaryString(file);
}

function handleCashStockFile(file) {
    const reader = new FileReader();
    reader.onload = evt => {
        const data = evt.target.result;
        const workbook = XLSX.read(data, { type: 'binary' });
        cashStockData = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]]);
        calculateTotalStockValue(cashStockData, "cashStockTotal");
        updateGenerateCashButtonState();
    };
    reader.readAsBinaryString(file);
}

function handlePurchaserNamesFile(file) {
    const reader = new FileReader();
    reader.onload = evt => {
        const data = evt.target.result;
        const workbook = XLSX.read(data, { type: 'binary' });
        const sheetData = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], { header: 1 });
        if (sheetData.length > 1) {
            purchaserNames = sheetData.slice(1).map(row => row[0]).filter(name => name).map(String);
        }
        updateGenerateCashButtonState();
    };
    reader.readAsBinaryString(file);
}

// --- UPI GENERATION LOGIC (RESTORED) ---
async function tryGenerateAllBills() {
    if (!stockData || !billTargets) return;
    
    const btn = document.getElementById("generateBtn");
    const originalText = btn.textContent;
    btn.disabled = true;
    btn.textContent = "Processing...";

    const stockMap = buildStockMap(stockData);
    const bills = [];
    
    // Create a Set to track rotation for UPI as well
    const upiUsedItemIds = new Set();

    for (const amountObj of billTargets) {
        const values = Object.values(amountObj);
        const target = parseFloat(values[0]);
        const date = values[1]; 
        
        if (isNaN(target) || !date) continue;
        
        // Use EXACT mode for UPI
        const bill = await generateBillFromMap(stockMap, target, target, target, date, 5, 'EXACT', 0, upiUsedItemIds);
        
        if (bill.success) {
            bills.push(bill);
            if (bill.tempUsedMap) {
                for (let [name, qty] of bill.tempUsedMap.entries()) {
                    const item = stockMap.get(name);
                    item.remainingQty = parseFloat((item.remainingQty - qty).toFixed(3));
                    upiUsedItemIds.add(name);
                }
            }
        }
    }
    
    const today = formatDate(new Date());
    exportBillsToExcel(bills, `generated-upi-bills-${today}.xlsx`, "billPrefix", "startIndex", "UPI");
    exportUpdatedStockToXLSX(stockMap, `updated-upi-stock-${today}.xlsx`);
    
    btn.textContent = originalText;
    btn.disabled = false;
    alert("UPI Bills Generated Successfully!");
}

// --- MAIN CASH LOGIC ---
async function tryGenerateCashBills() {
    let minBill = parseFloat(document.getElementById("cashMinBill").value);
    let maxBill = parseFloat(document.getElementById("cashMaxBill").value);
    
    if (!cashStockData || isNaN(minBill) || isNaN(maxBill)) return;

    const btn = document.getElementById("generateCashBtn");
    const originalText = btn.textContent;
    btn.disabled = true;
    btn.textContent = "Processing...";

    const statusArea = document.getElementById("statusArea");
    const logList = document.getElementById("skippedDaysLog");
    if(statusArea) statusArea.style.display = "block";
    if(logList) logList.innerHTML = "";

    minBill = Math.max(minBill, 10); 
    if (maxBill > 10000) maxBill = 10000;

    const stockMap = buildStockMap(cashStockData);
    const allGeneratedBills = [];
    let hasSkipped = false;
    
    let purchaserHistory = {}; 
    const availablePurchasers = purchaserNames.length > 0 ? [...purchaserNames] : ['N/A'];

    for (const { date, targetAmount } of dateAmountTargets) {
        
        if (targetAmount <= 0) continue; 

        let dateAccumulated = 0;
        let consecutiveFailures = 0; 
        
        let todaysBills = [];
        let dailyUsedItemIds = new Set(); // Reset rotation daily

        console.log(`Processing Date: ${date} | Target: ${targetAmount}`);

        while (dateAccumulated < targetAmount) {
            
            const remaining = targetAmount - dateAccumulated;

            if (remaining <= 5) {
                break; 
            }

            if (consecutiveFailures % 20 === 0) {
                const pct = ((dateAccumulated / targetAmount) * 100).toFixed(0);
                btn.textContent = `Date: ${formatDisplayDate(date)} | ${pct}% (Fails: ${consecutiveFailures})`;
                await waitFrame(); 
            }

            let currentMargin = 5; 
            let mode = 'RANGE';
            
            let randomTarget = minBill + Math.random() * (maxBill - minBill);
            let randomMin = Math.max(minBill, randomTarget * 0.95);
            let randomMax = Math.min(maxBill, randomTarget * 1.05);

            let targetMin = randomMin;
            let targetMax = randomMax;
            
            if (consecutiveFailures > 20) targetMin = 10; 

            if (remaining <= maxBill) {
                mode = 'EXACT';
                targetMin = remaining;
                targetMax = remaining;
                currentMargin = 50; 
            } else {
                if (targetMax > remaining) targetMax = remaining;
            }

            let bill = await generateBillFromMap(stockMap, targetMin, targetMax, remaining, date, currentMargin, mode, consecutiveFailures, dailyUsedItemIds);
            
            if (bill.success) {
                const recentBills = allGeneratedBills.slice(-3).concat(todaysBills.slice(-3));
                const last3Totals = recentBills.slice(-3).map(b => b.total);

                if (last3Totals.includes(bill.total) && consecutiveFailures < 50 && mode !== 'EXACT') {
                    consecutiveFailures++;
                    continue; 
                }

                if (bill.tempUsedMap) {
                    for (let [name, qty] of bill.tempUsedMap.entries()) {
                        const item = stockMap.get(name);
                        item.remainingQty = parseFloat((item.remainingQty - qty).toFixed(3));
                        dailyUsedItemIds.add(name);
                    }
                }

                todaysBills.push(bill);
                dateAccumulated += bill.total;
                consecutiveFailures = 0; 
            } else {
                consecutiveFailures++;
                
                if (consecutiveFailures > 500) {
                     hasSkipped = true;
                     const percentSkipped = ((remaining / targetAmount) * 100).toFixed(1);
                     
                     let logMsg = `Date: ${formatDisplayDate(date)} - Skipped ${percentSkipped}% (₹${remaining.toFixed(2)} remaining)`;
                     
                     if (dateAccumulated === 0) {
                         logMsg = `FAILURE: ${formatDisplayDate(date)} Skipped 100% (No valid bills generated). Moving to next day.`;
                     }

                     console.warn(logMsg);
                     if(logList) {
                         const li = document.createElement("li");
                         li.textContent = logMsg;
                         if (dateAccumulated === 0) {
                             li.style.color = "red";
                             li.style.fontWeight = "bold";
                         }
                         logList.appendChild(li);
                     }
                     break; 
                }
            }
        }

        if (todaysBills.length > 0) {
            let dailyNamePool = [...availablePurchasers];
            if (dailyNamePool.length > 1) shuffleArray(dailyNamePool);
            
            let nameIdx = 0;
            
            for (let b of todaysBills) {
                let assignedName = "N/A";
                
                if (availablePurchasers.length > 0 && availablePurchasers[0] !== 'N/A') {
                    let bestCandidate = null;
                    let attempts = 0;
                    
                    while (attempts < dailyNamePool.length) {
                        let candidate = dailyNamePool[nameIdx % dailyNamePool.length];
                        let lastTotal = purchaserHistory[candidate] || 0;
                        
                        if (Math.abs(lastTotal - b.total) > 1) {
                            bestCandidate = candidate;
                            nameIdx++; 
                            break;
                        }
                        
                        nameIdx++;
                        attempts++;
                    }
                    
                    if (!bestCandidate) {
                        bestCandidate = dailyNamePool[nameIdx % dailyNamePool.length];
                        nameIdx++;
                    }
                    
                    assignedName = bestCandidate;
                    purchaserHistory[assignedName] = b.total; 
                }
                
                b.purchaserName = assignedName;
                allGeneratedBills.push(b);
            }
        }
    }

    const today = formatDate(new Date());
    exportBillsToExcel(allGeneratedBills, `cash-bills-${today}.xlsx`, "cashStockPrefix", "cashBillStartIndex", "Cash");
    exportUpdatedStockToXLSX(stockMap, `updated-cash-stock-${today}.xlsx`);

    btn.textContent = originalText;
    btn.disabled = false;
    
    if (hasSkipped) {
        alert("Completed with some skipped days. Check the log.");
    } else {
        alert("Bills generated successfully for ALL days!");
    }
}

document.addEventListener("DOMContentLoaded", () => {
    const stockInput = document.getElementById("stockInput");
    const billInput = document.getElementById("billInput");
    const generateBtn = document.getElementById("generateBtn");
    
    const cashStockInput = document.getElementById("cashStockInput");
    const generateCashBtn = document.getElementById("generateCashBtn");
    const cashStartDateInput = document.getElementById("cashStartDate");
    const cashEndDateInput = document.getElementById("cashEndDate");
    const purchaserNamesInput = document.getElementById("purchaserNamesInput"); 

    if(stockInput) stockInput.onchange = e => handleStockFile(e.target.files[0]);
    if(billInput) billInput.onchange = e => handleBillAmountFile(e.target.files[0]);
    if(generateBtn) generateBtn.onclick = tryGenerateAllBills;

    if(cashStartDateInput) cashStartDateInput.onchange = generateDateTable;
    if(cashEndDateInput) cashEndDateInput.onchange = generateDateTable;

    ["cashMinBill", "cashMaxBill"].forEach(id => {
        const el = document.getElementById(id);
        if(el) el.oninput = updateGenerateCashButtonState;
    });

    if(cashStockInput) cashStockInput.onchange = e => handleCashStockFile(e.target.files[0]);
    if(purchaserNamesInput) purchaserNamesInput.onchange = e => handlePurchaserNamesFile(e.target.files[0]);
    
    if(generateCashBtn) generateCashBtn.onclick = tryGenerateCashBills;

    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.onclick = function () {
            document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            document.querySelectorAll('.tab-content').forEach(tc => tc.classList.remove('active'));
            const target = document.getElementById('tab-' + btn.dataset.tab);
            if(target) target.classList.add('active');
        };
    });
});