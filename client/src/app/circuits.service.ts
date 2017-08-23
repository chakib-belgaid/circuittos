///<reference path="circuit.ts"/>
import { Injectable } from '@angular/core';
import {Http, RequestOptions, Headers} from '@angular/http';
import {Circuit} from "./circuit";

@Injectable()
export class CircuitsService {
  private CircuitUrl = 'http://127.0.0.1:8000/level/';
   headers: Headers;
    options: RequestOptions;

  constructor(private http: Http) {
    this.headers = new Headers({'Accept': 'application/json'});
    this.options = new RequestOptions({headers: this.headers});


  }

  save_circuit(circuit) : Promise<any>
  {
    return this.http.post(this.CircuitUrl,circuit,this.options).toPromise()
      .then(value => {value;console.log(value)})
      .catch(reason => console.log(reason));
  }

  getCircuit(num): Promise<any>{
    return this.http.get(this.CircuitUrl+num+'/')
      .toPromise()
      .then(response =>{return response.json() })
      .catch(reason => console.log(reason));
  }


}
