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
        // Detect if stock has decimals initially
        const qty = Number(item["Qty."]) || 0;
        const isFloatStock = qty % 1 !== 0; 
        
        map.set(key, {
            ...item,
            remainingQty: qty,
            initialIsFloat: isFloatStock, 
            "Price": Number(item["Price"]) || 0,
            "GST PERCENT": Number(item["GST PERCENT"]) || 0,
            "CESS%": Number(item["CESS%"]) || 0,
            "MRP": Number(item["MRP"]) || 0,
            singleUnitCost: calculateItemTotal(Number(item["Price"]), 1, Number(item["GST PERCENT"]), Number(item["CESS%"]), Number(item["MRP"]))
        });
    }
    return map;
}

/** ======== Smart Bill Generation Logic ======== */
let billCounter = 0;

function getItemBillTotal(item, qty) {
    return calculateItemTotal(
        item["Price"],
        qty,
        item["GST PERCENT"] || 0,
        item["CESS%"] || 0,
        item["MRP"] || 0
    );
}

function waitFrame() {
    return new Promise(resolve => setTimeout(resolve, 0));
}

// Check if an item SHOULD be allowed to be sold in decimals
function canSellInFloat(item, roomLeft) {
    // 1. User Rule: MRP > 10000
    if (item["MRP"] > 10000) return true;
    
    // 2. User Rule: Stock is already float (e.g. 1.4 remaining)
    if (item.remainingQty % 1 !== 0) return true;
    
    // 3. Auto-Fit: If 1 unit is too expensive for the current bill/budget, allow float to fit it in.
    if (item.singleUnitCost > roomLeft) return true;

    return false;
}

// --- ASYNC SAFE GENERATOR FUNCTION ---
async function generateBillFromMap(stockMap, targetMin, targetMax, dayTotalRemaining, date, margin = 5, mode = 'RANGE', currentFailures = 0) {
    billCounter++;
    
    // 1. Prepare Available Stock
    // NOTE: We NO LONGER filter out expensive items. We will just decimal-ize them.
    let availableItems = Array.from(stockMap.values())
        .filter(item => item.remainingQty > 0.001); // Filter out effectively zero stock
        
    // Sort cheaply to expensive
    availableItems.sort((a, b) => a.singleUnitCost - b.singleUnitCost);

    const itemCount = availableItems.length;
    if (itemCount === 0) return { items: [], total: 0, success: false, reason: "No items available" };

    // --- DYNAMIC EFFORT SCALING ---
    let effortMultiplier = 1.0;
    if (currentFailures > 50) effortMultiplier = 0.2;   
    if (currentFailures > 500) effortMultiplier = 0.05; 
    if (currentFailures > 2000) effortMultiplier = 0.01; 

    const baseAttempts = [
        { count: 4, attempts: 50 },
        { count: 3, attempts: 50 },
        { count: 2, attempts: 100 }, 
        { count: 1, attempts: 20 }
    ];

    for (const tier of baseAttempts) {
        const minItems = tier.count;
        const maxAttempts = Math.max(1, Math.floor(tier.attempts * effortMultiplier));

        if (itemCount < minItems) continue;

        // With float logic, we can almost ALWAYS fit items, so strict feasibility check is relaxed.
        // We just check if we have enough items count-wise.

        let randomItems = [...availableItems];
        shuffleArray(randomItems);

        for (let attempt = 0; attempt < maxAttempts; attempt++) {
            
            if (attempt % 50 === 0) await waitFrame();

            let currentBill = [];
            let currentTotal = 0;
            let pickedCount = 0;
            let tempUsed = new Map();
            
            // Helper to get remaining stock for this specific bill calculation
            const getRem = (i) => {
                const used = tempUsed.get(i["Item Details"]) || 0;
                return Math.max(0, i.remainingQty - used);
            };

            // MODE A: RANGE
            if (mode === 'RANGE') {
                for (const item of randomItems) {
                    if (currentTotal >= targetMin && pickedCount >= minItems) {
                         if (Math.random() > 0.5) break; 
                    }
                    
                    const actualRemaining = getRem(item);
                    if (actualRemaining <= 0.001) continue;

                    const roomLeft = targetMax - currentTotal;
                    
                    // Stop if room is tiny
                    if (roomLeft < 1) continue;

                    let qty = 0;
                    const allowFloat = canSellInFloat(item, roomLeft);

                    // Calculate maximum possible quantity based on budget
                    // Formula: roomLeft / cost_of_1_unit
                    let maxQtyBudget = roomLeft / item.singleUnitCost;
                    
                    // The absolute max we can take is the lower of: Stock vs Budget
                    let absMax = Math.min(actualRemaining, maxQtyBudget);

                    if (allowFloat) {
                        // FLOAT LOGIC
                        // Pick a random portion of the available max
                        // Ensure we don't pick tiny dust (min 0.01)
                        if (absMax < 0.01) continue;
                        
                        // Heuristic: Try to take a significant chunk, not just 0.01
                        let factor = Math.random() * 0.8 + 0.2; // 20% to 100% of max
                        qty = parseFloat((absMax * factor).toFixed(2));
                        
                        // Safety: if variety needed, cap it
                        if (pickedCount < minItems && qty > absMax / 2) {
                             qty = parseFloat((absMax / 2).toFixed(2));
                        }
                    } else {
                        // INTEGER LOGIC
                        let intMax = Math.floor(absMax);
                        if (intMax < 1) continue; // Can't fit even 1 unit
                        
                        // Variety check
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
            } 
            
            // MODE B: EXACT (The Sniper with Float powers)
            else if (mode === 'EXACT') {
                 // Try to fill random base items first
                 for (let i = 0; i < minItems - 1; i++) {
                    const remaining = targetMax - currentTotal;
                    if (remaining <= 5) break; // almost full

                    // Pick random
                    const r = randomItems[Math.floor(Math.random()*randomItems.length)];
                    const actualRemaining = getRem(r);
                    if (actualRemaining <= 0.001) continue;

                    // Reserve budget for at least 1 more item? 
                    // With float, we can usually squeeze anything, but let's be safe.
                    const safeMax = remaining * 0.8; 
                    
                    let qty = 0;
                    let maxQtyBudget = safeMax / r.singleUnitCost;
                    let absMax = Math.min(actualRemaining, maxQtyBudget);
                    
                    if (canSellInFloat(r, safeMax)) {
                        if (absMax < 0.01) continue;
                        qty = parseFloat((Math.random() * absMax).toFixed(2));
                    } else {
                        let intMax = Math.floor(absMax);
                        if (intMax < 1) continue;
                        qty = Math.floor(Math.random() * intMax) + 1;
                    }

                    if (qty > 0) {
                        let cost = getItemBillTotal(r, qty);
                        currentBill.push({ item: r, qty, cost });
                        currentTotal += cost;
                        pickedCount++;
                        tempUsed.set(r["Item Details"], (tempUsed.get(r["Item Details"])||0)+qty);
                    }
                 }
                 
                 // Sniper Fill - Try to find perfect float match
                 if (pickedCount >= minItems - 1) {
                     const gap = targetMax - currentTotal;
                     if (gap > 0.1) {
                         // Find item that has enough stock to cover the gap
                         // Preference: Float allowed items
                         const candidate = availableItems.find(i => {
                             const rem = getRem(i);
                             const costOfRem = getItemBillTotal(i, rem); // Rough check
                             return rem > 0 && costOfRem >= gap;
                         });

                         if (candidate) {
                             // Calculate exact QTY needed for Gap
                             // Price * Qty = Gap  => Qty = Gap / Price
                             let neededQty = gap / candidate["Price"];
                             
                             // Adjust for Taxes to be precise?
                             // Iterative approach is safer for tax rounding:
                             // Estimate:
                             let exactQty = parseFloat((gap / candidate.singleUnitCost).toFixed(2));
                             
                             // Check limits
                             if (exactQty <= getRem(candidate) && exactQty > 0) {
                                 // Check if float allowed OR if it happens to be integer
                                 if (canSellInFloat(candidate, gap) || Number.isInteger(exactQty)) {
                                     let cost = getItemBillTotal(candidate, exactQty);
                                     // If cost is close enough
                                     if (Math.abs(cost - gap) < 5) {
                                         currentBill.push({ item: candidate, qty: exactQty, cost });
                                         currentTotal += cost;
                                         pickedCount++;
                                     }
                                 }
                             }
                         }
                     }
                 }
            }

            // Validation
            let isValid = false;
            
            // Allow slight variance in Exact mode due to float rounding
            const tolerance = mode === 'EXACT' ? margin : 0; 

            if (mode === 'RANGE') {
                if (currentTotal >= targetMin && currentTotal <= targetMax && pickedCount >= minItems) isValid = true;
            } else {
                 if (Math.abs(targetMax - currentTotal) <= tolerance && pickedCount >= minItems) isValid = true;
            }

            if (isValid) {
                const futureDayRemaining = dayTotalRemaining - currentTotal;
                // With floats, we can basically always finish, so "Safe Landing" is much easier.
                // Just check we aren't leaving 0.05 rupees or something tiny that isn't 0.
                if (futureDayRemaining <= margin || futureDayRemaining > 50) { 
                    currentBill.forEach(entry => {
                        const realItem = stockMap.get(entry.item["Item Details"]);
                        realItem.remainingQty = parseFloat((realItem.remainingQty - entry.qty).toFixed(3));
                    });
                    return formatResult(currentBill, currentTotal, targetMax, date);
                }
            }
            shuffleArray(randomItems);
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

function exportBillsToExcel(bills, filename, prefixId, indexId, paymentMethod) {
    const prefixElement = document.getElementById(prefixId);
    const indexElement = document.getElementById(indexId);
    const prefix = prefixElement ? prefixElement.value : "BILL";
    const startIndex = indexElement ? (parseInt(indexElement.value, 10) || 1) : 1;
    
    const rows = [];
    
    const namesToAssign = purchaserNames.length > 0 && paymentMethod === "Cash" ? [...purchaserNames] : ['N/A'];
    if (paymentMethod === "Cash" && namesToAssign.length > 1) {
        shuffleArray(namesToAssign);
    }
    let purchaserIndexCounter = 0;
    const totalNames = namesToAssign.length;
    
    bills.forEach((bill, index) => {
        const billPurchaserName = namesToAssign[purchaserIndexCounter % totalNames];
        purchaserIndexCounter++;
        
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

function tryGenerateAllBills() { /* UPI Logic (Unchanged) */ }

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
    let abortAll = false;
    
    for (const { date, targetAmount } of dateAmountTargets) {
        if (abortAll) break; 

        if (targetAmount <= 0) continue; 

        let dateAccumulated = 0;
        let consecutiveFailures = 0; 
        
        console.log(`Processing Date: ${date} | Target: ${targetAmount}`);

        while (dateAccumulated < targetAmount) {
            
            if (consecutiveFailures % 20 === 0) {
                const pct = ((dateAccumulated / targetAmount) * 100).toFixed(0);
                btn.textContent = `Date: ${formatDisplayDate(date)} | ${pct}% (Fails: ${consecutiveFailures})`;
                await waitFrame(); 
            }

            const remaining = targetAmount - dateAccumulated;
            let currentMargin = 5; 
            let mode = 'RANGE';
            let targetMin = minBill;
            let targetMax = maxBill;
            
            if (consecutiveFailures > 20) targetMin = 10; 

            if (remaining <= maxBill) {
                mode = 'EXACT';
                targetMin = remaining;
                targetMax = remaining;
                currentMargin = 50; 
            } else {
                if (targetMax > remaining) targetMax = remaining;
            }

            let bill = await generateBillFromMap(stockMap, targetMin, targetMax, remaining, date, currentMargin, mode, consecutiveFailures);
            
            if (bill.success) {
                allGeneratedBills.push(bill);
                dateAccumulated += bill.total;
                consecutiveFailures = 0; 
            } else {
                consecutiveFailures++;
                
                if (consecutiveFailures > 5000) {
                     hasSkipped = true;
                     const percentSkipped = ((remaining / targetAmount) * 100).toFixed(1);
                     
                     if (dateAccumulated === 0) {
                         const logMsg = `CRITICAL FAILURE: ${formatDisplayDate(date)} Skipped 100%. Aborting all future days.`;
                         console.error(logMsg);
                         if(logList) {
                             const li = document.createElement("li");
                             li.style.color = "red";
                             li.style.fontWeight = "bold";
                             li.textContent = logMsg;
                             logList.appendChild(li);
                         }
                         abortAll = true; 
                     } else {
                         const logMsg = `Date: ${formatDisplayDate(date)} - Skipped ${percentSkipped}% (₹${remaining.toFixed(2)} remaining)`;
                         console.warn(logMsg);
                         if(logList) {
                             const li = document.createElement("li");
                             li.textContent = logMsg;
                             logList.appendChild(li);
                         }
                     }
                     break; 
                }
            }
        }
    }

    const today = formatDate(new Date());
    exportBillsToExcel(allGeneratedBills, `cash-bills-${today}.xlsx`, "cashStockPrefix", "cashBillStartIndex", "Cash");
    exportUpdatedStockToXLSX(stockMap, `updated-cash-stock-${today}.xlsx`);

    btn.textContent = originalText;
    btn.disabled = false;
    
    if (abortAll) {
        alert("Process Aborted: A day was 100% skipped. Output generated for completed days only.");
    } else if (hasSkipped) {
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