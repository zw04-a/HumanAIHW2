from fastapi import FastAPI, HTTPException, File, UploadFile
from fastapi.staticfiles import StaticFiles
from starlette.responses import FileResponse
from fastapi.middleware.cors import CORSMiddleware 
from pydantic import BaseModel
import pandas as pd
import os
from dotenv import load_dotenv
from io import StringIO
import json
import openai
import logging
import numpy as np  # Added import for numpy
import re  # Added import for regular expressions
from typing import Optional



# Configure logging
logging.basicConfig(level=logging.DEBUG)

# Load environment variables from .env file
load_dotenv()

app = FastAPI()

# Mount the static directory
app.mount("/static", StaticFiles(directory="static"), name="static")

# Configure CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Adjust this to restrict allowed origins
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Global variable to store the uploaded dataset
uploaded_df = None

# Define request and response models
class QueryRequest(BaseModel):
    prompt: str
    userQuery: str  # Added field to receive the user's original input

class QueryResponse(BaseModel):
    response: Optional[str] = None  # Make the response field optional
    vegaSpec: Optional[dict] = None  # Make the vegaSpec field optional as well if needed

    
class DescriptionRequest(BaseModel):
    data: list
    userQuery: str

class DescriptionResponse(BaseModel):
    description: str

# Endpoint to handle file upload
@app.post("/upload")
async def upload_file(file: UploadFile = File(...)):
    global uploaded_df
    try:
        content = await file.read()
        uploaded_df = pd.read_csv(StringIO(content.decode('utf-8')))
        return {"status": "success", "message": "File uploaded and parsed successfully."}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to upload and parse file: {str(e)}")

# Endpoint to provide a preview of the uploaded dataset
@app.get("/preview")
async def preview_data():
    global uploaded_df

    if uploaded_df is None:
        raise HTTPException(status_code=400, detail="No dataset uploaded.")

    try:
        preview_data = uploaded_df.head(10).to_dict(orient='records')  # Return first 5-10 rows as a preview
        return {"status": "success", "preview": preview_data}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to generate preview: {str(e)}")

# Set OpenAI API key
openai.api_key = os.getenv("OPENAI_API_KEY")
if not openai.api_key:
    raise ValueError("OpenAI API key not found in environment variables.")

# Endpoint to handle user queries
# Endpoint to handle user queries
@app.post("/query", response_model=QueryResponse)
async def query_openai(request: QueryRequest):
    global uploaded_df

    if uploaded_df is None:
        return QueryResponse(response="Please upload a dataset before sending a message.")

    try:
        # Extract column names from the dataset and convert to lowercase
        column_names = [col.lower() for col in uploaded_df.columns.tolist()]
        logging.debug(f"Column names: {column_names}")

        # Tokenize the column names into individual words
        column_name_words = set()
        for col in column_names:
            words = re.findall(r'\w+', col)
            column_name_words.update(words)
        logging.debug(f"Column name words: {column_name_words}")

        # Convert the user's original input to lowercase and tokenize
        prompt_lower = request.userQuery.lower()
        logging.debug(f"User input (lowercase): {prompt_lower}")

        prompt_tokens = re.findall(r'\w+', prompt_lower)
        logging.debug(f"Input tokens: {prompt_tokens}")

        # Check if any word from column names is present in the user's input tokens
        column_in_prompt = any(word in column_name_words for word in prompt_tokens)
        logging.debug(f"Does the input contain any column name words? {column_in_prompt}")

        # If the user's input does not contain any column name words, consider it irrelevant
        if not column_in_prompt:
            return QueryResponse(response=f"The question '{request.userQuery}' is not relevant to the dataset. Ask a more relevant question please.")

        # System prompt to guide the generation of the Vega-Lite specification with "myData" placeholder
        system_prompt = (
            "You are a data visualization assistant responsible for generating Vega-Lite specifications. "
            "Please create a valid Vega-Lite JSON specification based on the user's request. "
            "Do not include actual data in the specification. Instead, use \"data\": {\"values\": \"myData\"} as a placeholder. "
            "Ensure the JSON adheres to the Vega-Lite schema."
        )

        # Construct messages including the system prompt and the generated prompt
        messages = [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": request.prompt}
        ]

        # Call OpenAI API to generate the Vega-Lite specification
        chat_completion = openai.chat.completions.create(
            model="gpt-3.5-turbo", 
            messages=messages,
            temperature=0,  # Set for deterministic output
            max_tokens=1000,  # Adjust as needed
        )

        # Extract OpenAI's response
        response_text = chat_completion.choices[0].message.content.strip()

        # Parse the response to extract the Vega-Lite specification
        try:
            vega_spec = json.loads(response_text)
        except json.JSONDecodeError:
            vega_spec = None
            response_text += "\nNote: The response could not be parsed as valid JSON."

        return QueryResponse(vegaSpec=vega_spec)
    except Exception as e:
        logging.exception("An error occurred during processing.")
        raise HTTPException(status_code=500, detail=str(e))
    


@app.post("/describe", response_model=DescriptionResponse)
async def describe_chart(request: DescriptionRequest):
    try:
        # 提取前30行数据作为样本
        sample_data = request.data

        # 构建描述生成的提示
        description_prompt = f'''
        Based on the sample data: {json.dumps(sample_data)},
        and the user's request: "{request.userQuery}",
        please provide a brief description of the chart that was generated based on this request.

        The description should be similar to: "This chart visualizes the relationship between weight and miles per gallon (MPG) of different car models, with points colored by the number of cylinders.".

        Please return only the description without any additional text.
        '''

        # 系统提示（可选）
        system_prompt = (
            "You are a data visualization assistant responsible for providing descriptions of charts. "
            "Please create a concise and accurate description based on the user's request and the provided data samples."
        )

        # 构建消息列表
        messages = [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": description_prompt}
        ]

        # 调用 OpenAI API 生成描述
        chat_completion = openai.chat.completions.create(
            model="gpt-3.5-turbo",
            messages=messages,
            temperature=0.5,  # 适当的创造性
            max_tokens=150  # 根据需要调整
        )

        # 提取描述
        description = chat_completion.choices[0].message.content.strip()

        # 确保仅返回描述文本
        description = description.split('\n')[0]  # 获取第一行作为描述

        return DescriptionResponse(description=description)

    except Exception as e:
        logging.exception("An error occurred during description generation.")
        raise HTTPException(status_code=500, detail=str(e))
    
# Root endpoint to serve the index.html file
@app.get("/")
async def read_root():
    return FileResponse('static/index.html')