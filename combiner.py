import os
import json

def combine_json_files(folder_path, output_file):
    combined_data = []
    
    # Iterate through each file in the folder
    for filename in os.listdir(folder_path):
        if filename.endswith('.json'):
            file_path = os.path.join(folder_path, filename)
            
            # Open and read the JSON file with utf-8 encoding to avoid UnicodeDecodeError
            with open(file_path, 'r', encoding='utf-8') as file:
                data = json.load(file)
                combined_data.append(data)
    
    # Write the combined data to the output file
    with open(output_file, 'w', encoding='utf-8') as outfile:
        json.dump(combined_data, outfile, indent=4)
# Example usage
combine_json_files(r'storage\datasets\default', 'hcpsd_codes_combined_output.json')
