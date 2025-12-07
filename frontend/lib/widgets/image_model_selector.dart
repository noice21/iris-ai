import 'package:flutter/material.dart';
import 'dart:convert';
import 'package:http/http.dart' as http;

class ImageModelSelector extends StatefulWidget {
  final String serverUrl;

  const ImageModelSelector({
    super.key,
    this.serverUrl = 'http://localhost:3001',
  });

  @override
  State<ImageModelSelector> createState() => _ImageModelSelectorState();
}

class _ImageModelSelectorState extends State<ImageModelSelector> {
  List<String> _models = [];
  String? _currentModel;
  bool _isLoading = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    _fetchModels();
  }

  Future<void> _fetchModels() async {
    setState(() {
      _isLoading = true;
      _error = null;
    });

    try {
      final response = await http.get(
        Uri.parse('${widget.serverUrl}/api/image-models'),
      );

      if (response.statusCode == 200) {
        final data = json.decode(response.body);
        if (data['success'] == true) {
          setState(() {
            _models = List<String>.from(data['models'] ?? []);
            _currentModel = data['currentModel'];
            _isLoading = false;
          });
        } else {
          setState(() {
            _error = data['error'] ?? 'Failed to load models';
            _isLoading = false;
          });
        }
      } else {
        setState(() {
          _error = 'Server error: ${response.statusCode}';
          _isLoading = false;
        });
      }
    } catch (e) {
      setState(() {
        _error = 'Connection error: $e';
        _isLoading = false;
      });
    }
  }

  Future<void> _setModel(String modelName) async {
    try {
      final response = await http.post(
        Uri.parse('${widget.serverUrl}/api/image-models/set'),
        headers: {'Content-Type': 'application/json'},
        body: json.encode({'modelName': modelName}),
      );

      if (response.statusCode == 200) {
        final data = json.decode(response.body);
        if (data['success'] == true) {
          setState(() {
            _currentModel = modelName;
          });
          if (mounted) {
            ScaffoldMessenger.of(context).showSnackBar(
              SnackBar(
                content: Text('Model changed to: $modelName'),
                duration: const Duration(seconds: 2),
                backgroundColor: Colors.green,
              ),
            );
          }
        }
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('Failed to set model: $e'),
            duration: const Duration(seconds: 3),
            backgroundColor: Colors.red,
          ),
        );
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    if (_isLoading) {
      return const Padding(
        padding: EdgeInsets.symmetric(horizontal: 16),
        child: SizedBox(
          width: 20,
          height: 20,
          child: CircularProgressIndicator(
            strokeWidth: 2,
            valueColor: AlwaysStoppedAnimation<Color>(Colors.white70),
          ),
        ),
      );
    }

    if (_error != null || _models.isEmpty) {
      return IconButton(
        icon: const Icon(Icons.image, color: Colors.grey),
        onPressed: _fetchModels,
        tooltip: _error ?? 'No models available',
      );
    }

    return PopupMenuButton<String>(
      icon: const Icon(Icons.image, color: Colors.white70),
      tooltip: 'Image Model: ${_getShortName(_currentModel ?? "None")}',
      onSelected: _setModel,
      itemBuilder: (context) {
        return _models.map((model) {
          final isSelected = model == _currentModel;
          return PopupMenuItem<String>(
            value: model,
            child: Row(
              children: [
                Icon(
                  isSelected ? Icons.check_circle : Icons.circle_outlined,
                  color: isSelected
                      ? Colors.green
                      : const Color.fromARGB(255, 241, 241, 241),
                  size: 18,
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: Text(
                    _getShortName(model),
                    style: TextStyle(
                      fontWeight: isSelected
                          ? FontWeight.bold
                          : FontWeight.normal,
                      color: isSelected
                          ? Colors.green
                          : Colors.white,
                    ),
                  ),
                ),
              ],
            ),
          );
        }).toList();
      },
    );
  }

  String _getShortName(String modelName) {
    // Remove .safetensors extension and shorten long names
    String name = modelName.replaceAll('.safetensors', '');
    if (name.length > 25) {
      return '${name.substring(0, 22)}...';
    }
    return name;
  }
}
