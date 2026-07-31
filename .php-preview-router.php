<?php

header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(200);
    exit();
}

$requestPath = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH);
$normalizedPath = str_replace('..', '', $requestPath);
$filePath = __DIR__ . $normalizedPath;


if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $response = [
        'method' => 'POST',
        'data' => $_POST,
        'files' => $_FILES,
        'timestamp' => time()
    ];
    header('Content-Type: application/json');
    echo json_encode($response);
    exit();
}


if (is_file($filePath)) {
    $extension = strtolower(pathinfo($filePath, PATHINFO_EXTENSION));
    
  
    $contentTypes = [
        'html' => 'text/html',
        'php' => 'text/html',
        'css' => 'text/css',
        'js' => 'application/javascript',
        'json' => 'application/json',
        'png' => 'image/png',
        'jpg' => 'image/jpeg',
        'jpeg' => 'image/jpeg',
        'gif' => 'image/gif',
        'svg' => 'image/svg+xml',
    ];
    
    if (isset($contentTypes[$extension])) {
        header('Content-Type: ' . $contentTypes[$extension]);
    }
    
   
    if ($extension === 'php') {
        try {
          
            ob_start();
            include($filePath);
            $output = ob_get_clean();
            
          
            if (isset($_GET['debug'])) {
                $debug = [
                    'file' => $filePath,
                    'size' => filesize($filePath),
                    'modified' => date('Y-m-d H:i:s', filemtime($filePath)),
                    'php_version' => PHP_VERSION,
                ];
                $output .= '\n<!-- Debug Info: ' . json_encode($debug) . ' -->';
            }
            
            echo $output;
        } catch (Throwable $e) {
            http_response_code(500);
            echo '<h1>PHP Error</h1>';
            echo '<pre>' . htmlspecialchars($e->getMessage()) . '</pre>';
        }
        exit();
    }
    

    readfile($filePath);
    exit();
}


http_response_code(404);
echo '<h1>404 Not Found</h1>';
echo '<p>The requested file "' . htmlspecialchars($requestPath) . '" was not found.</p>';
