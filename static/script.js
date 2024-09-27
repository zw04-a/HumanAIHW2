const sendBtn = document.querySelector('#send-btn');
const promptInput = document.querySelector('#prompt-input');
const responseText = document.querySelector('#response-text');
const uploadArea = document.querySelector('.upload_area');
const previewBtn = document.querySelector('#preview-btn');
let datasetUploaded = false;  // Flag to check if a dataset is uploaded
let previewVisible = false;   // Flag to track if the preview window is visible
let previewData = [];         // Variable to hold the preview data
let parsedData = [];          // Global variable to store the complete dataset

// Enable or disable the send button based on input value
promptInput.addEventListener('input', function(event) {
    sendBtn.disabled = event.target.value ? false : true;
});

// Handle file upload
uploadArea.addEventListener('dragover', (event) => {
    event.preventDefault();
    uploadArea.style.borderColor = '#337ab7'; // Highlight area on drag over
});

uploadArea.addEventListener('dragleave', () => {
    uploadArea.style.borderColor = '#ccc'; // Revert border color on drag leave
});

uploadArea.addEventListener('drop', (event) => {
    event.preventDefault();
    uploadArea.style.borderColor = '#ccc'; // Revert border color
    const file = event.dataTransfer.files[0];
    handleFileUpload(file);
});

uploadArea.addEventListener('click', () => {
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = '.csv';
    fileInput.onchange = (e) => {
        const file = e.target.files[0];
        handleFileUpload(file);
    };
    fileInput.click();
});

// Helper function to get column names from the preview data
function getColumnNames(previewData) {
    if (previewData.length > 0) {
        return Object.keys(previewData[0]);
    }
    return [];
}

// Helper function to determine data types (including all four types)
function getDataTypes(previewData) {
    if (previewData.length > 0) {
        const types = {};
        const firstRow = previewData[0];
        const columns = Object.keys(firstRow);

        columns.forEach(column => {
            const sampleValues = previewData.map(row => row[column]);
            let type = 'nominal'; // Default to nominal

            // Determine if the column is temporal (date or time)
            if (sampleValues.every(value => !isNaN(Date.parse(value)))) {
                type = 'temporal';
            }
            // Determine if the column is quantitative (all values are numbers)
            else if (sampleValues.every(value => !isNaN(value) && typeof value === 'number')) {
                type = 'quantitative';
            }
            // Determine if the column is ordinal (discrete ordered categories)
            else if (sampleValues.every(value => typeof value === 'string' && !isNaN(parseFloat(value)))) {
                type = 'ordinal';
            }

            types[column] = type;
        });

        return types;
    }
    return {};
}

// Helper function to get sample values (first few rows)
function getSampleValues(previewData, numberOfSamples = 3) {
    return previewData.slice(0, numberOfSamples);
}

// Function to generate the Vega-Lite prompt
function generateVegaLitePrompt(columns, types, sampleValues, userQuery) {
    let prompt = `You are to generate a JSON object that adheres to the Vega-Lite specification to create a data visualization.\n`;
    prompt += `The dataset has the following columns: ${columns.join(", ")}.\n`;
    prompt += `The data types for each column are: ${JSON.stringify(types)}.\n`;
    prompt += `Here are some sample values from the dataset: ${JSON.stringify(sampleValues)}.\n`;
    prompt += `Please generate a Vega-Lite JSON specification to visualize this data based on the following user query: ${userQuery}.\n`;
    prompt += `Ensure the JSON output is structured with proper "data", "mark", "encoding" keys as per Vega-Lite standard.\n`;
    prompt += `Use "https://vega.github.io/schema/vega-lite/v5.json" as the schema URL.`;

    return prompt;
}

function constructPromptForDescription(data, userQuery) {
    const sampleValues = data.slice(0, 30);  // 提取前30行作为示例

    const prompt = `
    Based on the sample data: ${JSON.stringify(sampleValues)},
    and the user's request: "${userQuery}",
    please provide a brief description of the chart that was generated based on this request.

    The description should be similar to: "This chart visualizes the relationship between weight and miles per gallon (MPG) of different car models, with points colored by the number of cylinders.".

    Please return only the description without any additional text.
    `;

    return prompt;
}



function handleFileUpload(file) {
    if (file && file.type === 'text/csv') {
        const formData = new FormData();
        formData.append('file', file);

        fetch('/upload', { // Update with your actual endpoint
            method: 'POST',
            body: formData
        })
        .then(response => response.json())
        .then(data => {
            if (data.status === "success") {
                datasetUploaded = true;  // Set flag when upload is successful
                fetchPreviewData().then(() => {
                    if (previewData.length > 0) {
                        showPreviewWindow(); // Automatically show preview window
                    } else {
                        addMessageToChat('left', 'No preview available.');
                    }
                });

                // Additionally, parse the CSV on the front-end to store the full dataset
                const reader = new FileReader();
                reader.onload = function(event) {
                    const csvData = event.target.result;
                    parsedData = d3.csvParse(csvData, d3.autoType); // Ensure d3 is loaded
                };
                reader.readAsText(file);
            } else {
                addMessageToChat('left', 'Error: ' + data.message);
            }
        })
        .catch(error => {
            console.error('Error:', error);
            addMessageToChat('left', 'Error: Failed to upload the dataset.');
        });
    } else {
        addMessageToChat('left', 'Please upload a valid CSV file.');
    }
}

function fetchPreviewData() {
    return fetch('/preview', {
        method: 'GET',
        headers: {
            'Content-Type': 'application/json'
        }
    })
    .then(response => response.json())
    .then(data => {
        if (data && data.preview) {
            previewData = data.preview.slice(0, 10); // Store first 5-10 rows for preview
            previewBtn.disabled = false; // Enable preview button after data is fetched
        } else {
            previewBtn.disabled = true;
            addMessageToChat('left', 'No preview available.');
        }
    })
    .catch(error => {
        console.error('Error:', error);
        addMessageToChat('left', 'Error: Failed to fetch preview data.');
    });
}

// Toggle preview window when the "Show Table Preview" button is clicked
previewBtn.addEventListener('click', toggleTablePreview);

function toggleTablePreview() {
    if (!datasetUploaded || previewData.length === 0) {
        addMessageToChat('left', 'Please upload a dataset to preview.');
        return;
    }

    if (previewVisible) {
        hidePreviewWindow();
    } else {
        showPreviewWindow();
    }
}

function showPreviewWindow() {
    const previewWindow = document.createElement('div');
    previewWindow.classList.add('preview-window');
    previewWindow.innerHTML = generatePreviewTable(previewData);
    document.body.appendChild(previewWindow);
    previewVisible = true;
    previewBtn.textContent = "Hide Table Preview";
}

function hidePreviewWindow() {
    const previewWindow = document.querySelector('.preview-window');
    if (previewWindow) {
        document.body.removeChild(previewWindow);
        previewVisible = false;
        previewBtn.textContent = "Show Table Preview";
    }
}

function generatePreviewTable(previewData) {
    let tableHtml = '<table class="preview-table"><thead><tr>';

    // Generate table headers
    const headers = Object.keys(previewData[0]);
    headers.forEach(header => {
        tableHtml += `<th>${header}</th>`;
    });
    tableHtml += '</tr></thead><tbody>';

    // Generate table rows
    previewData.forEach(row => {
        tableHtml += '<tr>';
        headers.forEach(header => {
            tableHtml += `<td>${row[header]}</td>`;
        });
        tableHtml += '</tr>';
    });

    tableHtml += '</tbody></table>';
    return tableHtml;
}

// Function to send the user's message to the FastAPI backend and display the response
async function sendMessage() {
    const userQuery = promptInput.value.trim(); // Get user input
    if (!userQuery) {
        return;   
    }

    // Check if a dataset has been uploaded
    if (!datasetUploaded) {
        addMessageToChat('left', 'Please upload a dataset before sending a message.');
        return;
    }

    // Use helper functions to get column names, data types, and sample values
    const columns = getColumnNames(previewData);
    const types = getDataTypes(previewData);
    const sampleValues = getSampleValues(previewData);

    // Generate the prompt for Vega-Lite
    const vegaPrompt = generateVegaLitePrompt(columns, types, sampleValues, userQuery);

    // Clear the input box and disable the send button
    promptInput.value = '';
    sendBtn.disabled = true;

    // Immediately add the user's message to the chatbox
    addMessageToChat('right', userQuery);

    try {
        // Send Vega-Lite specification request
        const vegaResponse = await fetch('/query', {
            method: 'POST',
            body: JSON.stringify({ 
                prompt: vegaPrompt,
                userQuery: userQuery
            }),
            headers: {
                'Content-Type': 'application/json'
            }
        });

        if (!vegaResponse.ok) {
            const err = await vegaResponse.json();
            throw new Error(err.detail || 'Server error');
        }

        const vegaData = await vegaResponse.json();

        let vegaSpec = null;

        if (vegaData.vegaSpec) {
            // Replace "myData" placeholder with actual data
            vegaSpec = { ...vegaData.vegaSpec };
            if (vegaSpec.data && vegaSpec.data.values === "myData") {
                vegaSpec.data.values = parsedData;
            }

            // Try to render the chart and wait for it to finish
            try {
                await renderChart(vegaSpec);

                // Comment out or remove this line to prevent the "Visualization generated." message
                // chartDescription = vegaData.response || 'Visualization generated.';
                // addMessageToChat('left', chartDescription);

                // Send description request only if the chart was rendered
                const descResponse = await fetch('/describe', {
                    method: 'POST',
                    body: JSON.stringify({ 
                        data: parsedData.slice(0, 30), // Pass the first 30 rows of data
                        userQuery: userQuery
                    }),
                    headers: {
                        'Content-Type': 'application/json'
                    }
                });

                if (!descResponse.ok) {
                    const err = await descResponse.json();
                    throw new Error(err.detail || 'Server error');
                }

                const descData = await descResponse.json();

                if (descData.description) {
                    addMessageToChat('left', descData.description);
                } else {
                    addMessageToChat('left', 'No description available.');
                }
            } catch (renderError) {
                // Chart rendering failed
                console.error('Chart rendering failed:', renderError);
                // Do not send description request
            }

        } else {
            addMessageToChat('left', vegaData.response || 'No visualization available.');
        }

    } catch (error) {
        console.error('Error:', error);
        addMessageToChat('left', `Error: ${error.message}`);
    } finally {
        sendBtn.disabled = false;
    }
}


// Function to add a message to the chatbox
function addMessageToChat(side, text) {
    // Create the new message list item
    const newMessage = document.createElement('li');
    newMessage.classList.add('message', side, 'appeared');

    // Create the avatar
    const avatar = document.createElement('div');
    avatar.classList.add('avatar');

    // Create the text wrapper
    const textWrapper = document.createElement('div');
    textWrapper.classList.add('text_wrapper');

    // Create the message text element
    const messageText = document.createElement('div');
    messageText.classList.add('text');
    messageText.textContent = text;

    // Append the text inside the text wrapper
    textWrapper.appendChild(messageText);

    // Add the avatar and the text wrapper to the message
    newMessage.appendChild(avatar);
    newMessage.appendChild(textWrapper);

    // Append the new message to the chatbox
    responseText.appendChild(newMessage);

    // Scroll to the bottom of the chatbox after adding the message
    responseText.scrollTop = responseText.scrollHeight;
}

// Function to render a Vega-Lite chart in the chatbox
function renderChart(vegaSpec) {
    return new Promise((resolve, reject) => {
        console.log("Vega-Lite Specification:", JSON.stringify(vegaSpec, null, 2));  // Log the Vega-Lite spec to the console
        const chartWrapper = document.createElement('div');
        chartWrapper.classList.add('message', 'left', 'appeared');

        vegaEmbed(chartWrapper, vegaSpec)
            .then(() => {
                responseText.appendChild(chartWrapper);
                responseText.scrollTop = responseText.scrollHeight;
                resolve(); // Resolve the promise on success
            })
            .catch(error => {
                console.error('Error rendering Vega-Lite chart:', error);
                // Notify the user that the Vega-Lite specification is ill-formed
                addMessageToChat('left', 'Unfortunately, the Vega-Lite specification is ill-formed, please send your request again.');
                reject(error); // Reject the promise on error
            });
    });
}

// Send the message when Enter is pressed
promptInput.addEventListener('keyup', function(event) {
    if (event.key === 'Enter') {
        sendBtn.click();
    }
});

// Send the message when the send button is clicked
sendBtn.addEventListener('click', sendMessage);