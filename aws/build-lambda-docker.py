#!/usr/bin/env python3
"""
Build Lambda deployment package using Docker (ensures Linux wheels)
Based on LocalDeployer docker_deployment.py logic
"""
import os
import sys
import subprocess
import logging
import threading
from pathlib import Path

# Set up logging
logging.basicConfig(
    level=logging.INFO,
    format='%(levelname)s: %(message)s'
)
logger = logging.getLogger(__name__)

def build_docker_image(dockerfile_path, build_context, image_name='diamonddrip-lambda-builder:latest'):
    """
    Build a Docker image from the Dockerfile
    
    Args:
        dockerfile_path: Path to Dockerfile
        build_context: Build context directory
        image_name: Docker image name and tag
        
    Returns:
        dict: Result with success status, stdout, stderr, etc.
    """
    logger.info(f"Building Docker image: {image_name}")
    
    # Prepare build command
    cmd = ["docker", "build", "-t", image_name, "-f", str(dockerfile_path), str(build_context)]
    
    logger.info(f"Running: {' '.join(cmd)}")
    
    try:
        process = subprocess.Popen(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            encoding='utf-8',
            errors='replace',
            bufsize=1
        )
        
        # Read output in real-time
        stdout_lines = []
        stderr_lines = []
        
        def read_output():
            try:
                for line in iter(process.stdout.readline, ''):
                    if not line:
                        break
                    stdout_lines.append(line)
                    # Print build progress
                    print(line.rstrip())
            except Exception as e:
                logger.warning(f"Error reading stdout: {e}")
        
        def read_errors():
            try:
                for line in iter(process.stderr.readline, ''):
                    if not line:
                        break
                    stderr_lines.append(line)
                    # Print errors
                    print(line.rstrip(), file=sys.stderr)
            except Exception as e:
                logger.warning(f"Error reading stderr: {e}")
        
        stdout_thread = threading.Thread(target=read_output, daemon=True)
        stderr_thread = threading.Thread(target=read_errors, daemon=True)
        stdout_thread.start()
        stderr_thread.start()
        
        # Wait for process to complete
        exit_code = process.wait()
        stdout_thread.join(timeout=1)
        stderr_thread.join(timeout=1)
        
        stdout = ''.join(stdout_lines)
        stderr = ''.join(stderr_lines)
        
        return {
            "success": exit_code == 0,
            "image_name": image_name,
            "exit_code": exit_code,
            "stdout": stdout,
            "stderr": stderr,
            "error": None if exit_code == 0 else f"Docker build failed with exit code {exit_code}"
        }
        
    except Exception as e:
        logger.error(f"Error building Docker image: {e}", exc_info=True)
        return {
            "success": False,
            "image_name": image_name,
            "error": str(e),
            "stdout": "",
            "stderr": ""
        }

def extract_lambda_package(image_name, output_path, package_path_in_container="/build/lambda-package.zip"):
    """
    Extract lambda-package.zip from the built Docker image.
    
    Args:
        image_name: Docker image name
        output_path: Path where to save the extracted package
        package_path_in_container: Path to package inside container
        
    Returns:
        Path to extracted package if successful, None otherwise
    """
    output_path = Path(output_path)
    
    logger.info(f"Extracting lambda-package.zip from image {image_name}...")
    
    try:
        # Create a temporary container to extract from
        create_result = subprocess.run(
            ["docker", "create", image_name],
            capture_output=True,
            text=True,
            timeout=30
        )
        
        if create_result.returncode != 0:
            logger.error(f"Failed to create container: {create_result.stderr}")
            return None
        
        container_id = create_result.stdout.strip()
        
        try:
            # Copy the package from container
            logger.info(f"Copying package from container to {output_path}...")
            copy_result = subprocess.run(
                ["docker", "cp", f"{container_id}:{package_path_in_container}", str(output_path)],
                capture_output=True,
                text=True,
                timeout=60
            )
            
            if copy_result.returncode == 0 and output_path.exists():
                package_size = output_path.stat().st_size / (1024 * 1024)  # Size in MB
                logger.info(f"Successfully extracted package to {output_path} ({package_size:.2f} MB)")
                return output_path
            else:
                logger.error(f"Failed to copy package: {copy_result.stderr}")
                return None
                
        finally:
            # Always remove the temporary container
            subprocess.run(
                ["docker", "rm", container_id],
                capture_output=True,
                timeout=10
            )
            
    except subprocess.TimeoutExpired:
        logger.error("Timeout while extracting lambda package")
        return None
    except Exception as e:
        logger.error(f"Error extracting lambda package: {e}", exc_info=True)
        return None

def main():
    """Main function to build and extract Lambda package"""
    # Get script directory and project root
    script_dir = Path(__file__).parent
    project_root = script_dir.parent
    os.chdir(project_root)
    
    # Paths
    dockerfile_path = script_dir / "Dockerfile"
    build_context = project_root  # Use project root so we can access synchronizer/
    image_name = "diamonddrip-lambda-builder:latest"
    output_path = script_dir / "lambda-package-docker.zip"
    
    # Check Dockerfile exists
    if not dockerfile_path.exists():
        logger.error(f"Dockerfile not found at {dockerfile_path}")
        sys.exit(1)
    
    print("=" * 60)
    print("Building Lambda Package with Docker (Linux Wheels)")
    print("=" * 60)
    print()
    
    # Build Docker image
    print("Step 1: Building Docker image...")
    build_result = build_docker_image(dockerfile_path, build_context, image_name)
    
    if not build_result["success"]:
        logger.error(f"Failed to build Docker image: {build_result.get('error', 'Unknown error')}")
        if build_result.get("stderr"):
            print("\nBuild errors:")
            print(build_result["stderr"])
        sys.exit(1)
    
    print("\n✓ Docker image built successfully")
    print()
    
    # Extract Lambda package
    print("Step 2: Extracting Lambda package from container...")
    extracted_path = extract_lambda_package(image_name, output_path)
    
    if not extracted_path:
        logger.error("Failed to extract Lambda package from container")
        sys.exit(1)
    
    print()
    print("=" * 60)
    print("✓ Build Complete!")
    print("=" * 60)
    print(f"\nPackage location: {extracted_path}")
    print(f"Package size: {extracted_path.stat().st_size / (1024 * 1024):.2f} MB")
    print(f"\nThis package contains Linux wheels and is ready for AWS Lambda deployment.")
    print()

if __name__ == '__main__':
    main()

